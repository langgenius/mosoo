import {
  applyAgUiEventToSessionLiveState,
  applyToolCallUpdateToSessionLiveState,
  createInitialSessionLiveState,
  createServerCustomEvent,
  EventType,
  MOSOO_CUSTOM_EVENT,
  parseAgUiSessionEvent,
  parseNullableSessionUsageSummary,
} from "@mosoo/ag-ui-session";
import type {
  AgUiSessionEvent,
  SessionLiveState,
  SessionViewPlanEntry,
} from "@mosoo/ag-ui-session";
import { sessionEventsTable } from "@mosoo/db";
import type { SessionId, SessionMessageId, SessionRunId } from "@mosoo/id";
import { createSessionRunTerminalSourceId } from "@mosoo/runtime-events";
import { and, asc, desc, eq, gt, gte, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  ProviderPrivateMarkupStreamFilter,
  sanitizeProviderPrivateMarkup,
} from "../domain/provider-private-markup";
import {
  createMessageStreamReducerState,
  MESSAGE_STREAM_AUTHORITY_BOUNDARY_EVENT_TYPES,
  MESSAGE_STREAM_EVENT_TYPES,
  reduceMessageStreamRow,
} from "../domain/session-event-stream-fold";
import type {
  MessageStreamReducerState,
  StreamFoldableSessionEventRow,
} from "../domain/session-event-stream-fold";
import { readTerminalEventSemanticAuthority } from "../domain/session-terminal-event-authority";

const REFERENCE_EVENT_PAGE_SIZE = 1_000;
const BOUNDED_REFERENCE_EVENT_PAGE_SIZE = 1_000;
const BOUNDED_REFERENCE_EVENT_PAGE_CHARS = 512 * 1_024;
const RUN_TERMINAL_EVENT_TYPES = ["run.cancelled", "run.completed", "run.failed"];
const MESSAGE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(MESSAGE_STREAM_EVENT_TYPES);
const THOUGHT_EVENT_TYPES = new Set([
  "thought.cancelled",
  "thought.completed",
  "thought.delta",
  "thought.started",
]);
const THOUGHT_PROCESS_TYPE = "agent.thinking.delta";
const USER_MESSAGE_PROCESS_TYPE = "user.message";
const ACTIVE_SESSION_STATE_EVENT_TYPES = [
  "session.commands.updated",
  "session.config.updated",
  "session.mode.updated",
  "usage.updated",
] as const;

export interface StoredSessionMessageReferenceRow {
  content_text: string;
  id: SessionMessageId;
  plan_json: string | null;
  projection_format: "event_stream_v3" | "materialized";
  role: "assistant" | "user";
  segments_json: string | null;
  session_run_id: SessionRunId | null;
}

interface ReferenceEventRow extends StreamFoldableSessionEventRow {
  tool_call_id: string | null;
  tool_input_delta_json: string | null;
  tool_input_json: string | null;
  tool_name: string | null;
  tool_output_delta_text: string | null;
  tool_output_text: string | null;
  tool_parent_message_id: string | null;
  tool_result_message_id: string | null;
  tool_status: "cancelled" | "completed" | "failed" | "running" | null;
  visibility: string;
}

interface ReferenceState {
  isCarrier: boolean;
  isFinal: boolean;
  live: SessionLiveState;
  message: MessageStreamReducerState;
  planJson: string | null;
}

interface ContentReferenceState {
  filter: ProviderPrivateMarkupStreamFilter;
  hasStreamText: boolean;
  message: MessageStreamReducerState;
}

interface SealedReferenceCursor {
  endSeq: number;
  startSeq: number;
}

interface LightweightReference {
  messageId: SessionMessageId;
  runId: SessionRunId;
}

interface CanonicalReference extends LightweightReference {
  isCarrier: boolean;
  isFinal: boolean;
}

interface TerminalReference {
  messageId: string | null;
  seq: number;
}

interface SessionStateEventRow {
  content_text: string;
  event_type: string;
  seq: number;
  visibility: string;
}

interface ToolRoute {
  authority: "carrier" | "final" | null;
  firstOutputSeq: number | null;
  firstParentSeq: number | null;
  parentMessageId: string | null;
  referenceKeys: Set<string>;
  resultMessageId: string | null;
  runId: SessionRunId;
  toolCallId: string;
}

export interface StoredSessionMessageContentReferenceRow {
  content_text: string;
  id: SessionMessageId;
  projection_format: "event_stream_v3" | "materialized";
  role: "assistant" | "user";
  session_run_id: SessionRunId | null;
}

function referenceKey(runId: SessionRunId, messageId: string): string {
  return JSON.stringify([runId, messageId]);
}

function potentialReference(
  row: StoredSessionMessageContentReferenceRow,
): LightweightReference | null {
  return row.projection_format === "event_stream_v3" &&
    row.role === "assistant" &&
    row.session_run_id !== null
    ? { messageId: row.id, runId: row.session_run_id }
    : null;
}

function requireTerminalReferences(
  candidates: readonly LightweightReference[],
  terminalReferences: ReadonlyMap<SessionRunId, TerminalReference>,
): CanonicalReference[] {
  const references: CanonicalReference[] = [];
  for (const reference of candidates) {
    const terminal = terminalReferences.get(reference.runId);
    const isCarrier = String(reference.messageId) === String(reference.runId);
    const isFinal = terminal?.messageId === reference.messageId;
    if (terminal === undefined || (!isCarrier && !isFinal)) {
      throw new Error(
        `Stored event-stream assistant ${reference.messageId} has no exact terminal authority.`,
      );
    }
    references.push({ ...reference, isCarrier, isFinal });
  }
  return references;
}

function createReferenceState(
  sessionId: SessionId,
  reference: Pick<CanonicalReference, "isCarrier" | "isFinal"> = {
    isCarrier: false,
    isFinal: false,
  },
): ReferenceState {
  return {
    ...reference,
    live: createInitialSessionLiveState({ sessionId, title: null, viewerId: "reference" }),
    message: createMessageStreamReducerState(),
    planJson: null,
  };
}

function createContentReferenceState(): ContentReferenceState {
  return {
    filter: new ProviderPrivateMarkupStreamFilter(),
    hasStreamText: false,
    message: createMessageStreamReducerState(),
  };
}

function reduceSanitizedMessageStreamRow(
  state: ContentReferenceState,
  row: StreamFoldableSessionEventRow,
  maxTextLength: number,
): void {
  if (row.event_type === "message.started" || row.event_type === "message.added") {
    state.filter = new ProviderPrivateMarkupStreamFilter();
    state.hasStreamText = false;
  }

  if (row.event_type === "message.added" || row.event_type === "message.delta") {
    state.hasStreamText ||= row.content_text.length > 0;
    reduceMessageStreamRow(
      state.message,
      { ...row, content_text: state.filter.push(row.content_text).text },
      { maxTextLength },
    );
    return;
  }

  if (row.event_type === "message.completed") {
    const trailingText = state.filter.finish().text;
    if (trailingText.length > 0) {
      reduceMessageStreamRow(
        state.message,
        { ...row, content_text: trailingText, event_type: "message.delta" },
        { maxTextLength },
      );
    }
    reduceMessageStreamRow(
      state.message,
      {
        ...row,
        content_text: state.hasStreamText
          ? ""
          : sanitizeProviderPrivateMarkup(row.content_text).text,
      },
      { maxTextLength },
    );
    return;
  }

  reduceMessageStreamRow(state.message, row, { maxTextLength });
}

function toolKey(runId: SessionRunId, toolCallId: string): string {
  return JSON.stringify([runId, toolCallId]);
}

function mergeToolRouteIdentity(
  route: ToolRoute,
  row: {
    tool_parent_message_id: string | null;
    tool_result_message_id: string | null;
  },
): void {
  if (
    (route.parentMessageId !== null &&
      row.tool_parent_message_id !== null &&
      route.parentMessageId !== row.tool_parent_message_id) ||
    (route.resultMessageId !== null &&
      row.tool_result_message_id !== null &&
      route.resultMessageId !== row.tool_result_message_id)
  ) {
    throw new Error(`Stored tool call ${route.toolCallId} changed its message identity.`);
  }
  route.parentMessageId ??= row.tool_parent_message_id;
  route.resultMessageId ??= row.tool_result_message_id;
}

function applyAgUiEvents(state: ReferenceState, events: readonly AgUiSessionEvent[]): void {
  for (const event of events) {
    state.live = applyAgUiEventToSessionLiveState(state.live, event);
  }
}

function messageAgUiEvent(row: ReferenceEventRow): AgUiSessionEvent {
  const messageId = row.stream_id;
  if (messageId === null) {
    throw new Error(`Stored ${row.event_type} event is missing its stream identity.`);
  }

  if (row.process_type === THOUGHT_PROCESS_TYPE) {
    switch (row.event_type) {
      case "thought.started":
        return { messageId, role: "reasoning", type: EventType.REASONING_MESSAGE_START };
      case "thought.delta":
        return {
          delta: row.content_text,
          messageId,
          type: EventType.REASONING_MESSAGE_CONTENT,
        };
      default:
        return { messageId, type: EventType.REASONING_MESSAGE_END };
    }
  }

  switch (row.event_type) {
    case "message.added":
      return {
        delta: row.content_text,
        messageId,
        role: row.process_type === USER_MESSAGE_PROCESS_TYPE ? "user" : "assistant",
        type: EventType.TEXT_MESSAGE_CHUNK,
      };
    case "message.started":
      return {
        messageId,
        role: row.process_type === USER_MESSAGE_PROCESS_TYPE ? "user" : "assistant",
        type: EventType.TEXT_MESSAGE_START,
      };
    case "message.delta":
      return { delta: row.content_text, messageId, type: EventType.TEXT_MESSAGE_CONTENT };
    default:
      return { messageId, type: EventType.TEXT_MESSAGE_END };
  }
}

function applyReferenceEvent(
  states: ReadonlyMap<string, ReferenceState>,
  statesByRun: ReadonlyMap<SessionRunId, ReferenceState[]>,
  ceilings: ReadonlyMap<SessionRunId, number>,
  toolRoutes: ReadonlyMap<string, ToolRoute>,
  row: ReferenceEventRow,
  options?: { activeArtifacts?: boolean },
): void {
  if (row.run_id === null || row.seq > (ceilings.get(row.run_id) ?? -1)) {
    return;
  }

  if (row.event_type === "plan.updated") {
    const runStates = statesByRun.get(row.run_id) ?? [];
    if (runStates.length > 0 && row.visibility !== "all_consumers") {
      throw new Error(`Session run ${row.run_id} has a mixed-visibility plan stream.`);
    }
    const plan: unknown = JSON.parse(row.content_text);
    if (!Array.isArray(plan)) {
      throw new Error(`Session run ${row.run_id} has an invalid plan projection.`);
    }
    for (const state of runStates) {
      state.planJson = row.content_text;
      state.live = applyAgUiEventToSessionLiveState(
        state.live,
        createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionPlanUpdated.name, {
          plan: plan as SessionViewPlanEntry[],
        }),
      );
    }
    return;
  }

  if (
    options?.activeArtifacts === true &&
    (row.process_type === THOUGHT_PROCESS_TYPE || row.process_type === USER_MESSAGE_PROCESS_TYPE)
  ) {
    if (row.visibility !== "all_consumers") {
      throw new Error(`Session run ${row.run_id} has a mixed-visibility message stream.`);
    }
    const supported =
      row.process_type === THOUGHT_PROCESS_TYPE
        ? THOUGHT_EVENT_TYPES.has(row.event_type)
        : MESSAGE_EVENT_TYPE_SET.has(row.event_type);
    if (!supported) {
      throw new Error(`Stored active message stream has unsupported event ${row.event_type}.`);
    }
    const event = messageAgUiEvent(row);
    for (const state of new Set(statesByRun.get(row.run_id) ?? [])) {
      state.live = applyAgUiEventToSessionLiveState(state.live, event);
    }
    return;
  }

  if (row.process_type === "agent.message.delta") {
    if (row.stream_id === null) {
      return;
    }
    const state = states.get(referenceKey(row.run_id, row.stream_id));
    if (state === undefined || !state.isFinal) {
      return;
    }
    if (row.visibility !== "all_consumers") {
      throw new Error("Stored assistant reference has a mixed-visibility message stream.");
    }
    if (!MESSAGE_EVENT_TYPE_SET.has(row.event_type)) {
      throw new Error(`Stored assistant reference has unsupported event ${row.event_type}.`);
    }
    reduceMessageStreamRow(state.message, row);
    applyAgUiEvents(state, [messageAgUiEvent(row)]);
    return;
  }

  if (row.event_type !== "tool.call.updated") {
    return;
  }
  if (row.visibility !== "all_consumers") {
    throw new Error("Stored assistant reference has a mixed-visibility tool stream.");
  }
  if (row.tool_call_id === null) {
    return;
  }
  const route = toolRoutes.get(toolKey(row.run_id, row.tool_call_id));
  if (route === undefined) {
    return;
  }
  mergeToolRouteIdentity(route, row);
  const resultMessageId = route.resultMessageId ?? route.parentMessageId;
  if (resultMessageId === null) {
    throw new Error(`Stored tool call ${row.tool_call_id} has no message identity.`);
  }
  const routedStates = new Set<ReferenceState>();
  for (const key of route.referenceKeys) {
    const state = states.get(key);
    if (state === undefined) {
      continue;
    }
    routedStates.add(state);
  }
  for (const state of routedStates) {
    const carrierAuthority = route.authority === "carrier";
    state.live = applyToolCallUpdateToSessionLiveState(state.live, {
      inputDelta: row.tool_input_delta_json,
      inputSnapshot: row.tool_input_json,
      outputDelta: row.tool_output_delta_text,
      outputSnapshot: row.tool_output_text,
      parentMessageId:
        row.tool_parent_message_id === null
          ? null
          : carrierAuthority
            ? route.runId
            : row.tool_parent_message_id,
      resultMessageId: carrierAuthority ? route.runId : resultMessageId,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      toolName: row.tool_name ?? "Tool",
    });
  }
}

function sessionStateAgUiEvent(row: SessionStateEventRow): AgUiSessionEvent {
  if (row.visibility !== "all_consumers") {
    throw new Error(`Session state event ${row.event_type} has mixed visibility.`);
  }
  const content: unknown = JSON.parse(row.content_text);
  if (row.event_type === "plan.updated") {
    if (!Array.isArray(content)) {
      throw new Error("Session plan event has an invalid projection.");
    }
    return createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionPlanUpdated.name, {
      plan: content as SessionViewPlanEntry[],
    });
  }
  const names = {
    "session.commands.updated": MOSOO_CUSTOM_EVENT.sessionCommandsUpdated.name,
    "session.config.updated": MOSOO_CUSTOM_EVENT.sessionConfigUpdated.name,
    "session.mode.updated": MOSOO_CUSTOM_EVENT.sessionModeUpdated.name,
    "usage.updated": MOSOO_CUSTOM_EVENT.sessionUsageUpdated.name,
  } as const;
  const name = names[row.event_type as keyof typeof names];
  if (name === undefined) {
    throw new Error(`Unsupported Session state event ${row.event_type}.`);
  }
  return parseAgUiSessionEvent({
    name,
    type: EventType.CUSTOM,
    value:
      row.event_type === "session.commands.updated"
        ? { commands: content }
        : row.event_type === "usage.updated"
          ? { usage: parseNullableSessionUsageSummary(content) }
          : content,
  });
}

async function readTerminalReferences(
  database: D1Database,
  sessionId: SessionId,
  runIdsInput: readonly SessionRunId[],
): Promise<Map<SessionRunId, TerminalReference>> {
  const runIds = [...new Set(runIdsInput)];
  const terminalRows = await getAppDatabase(database)
    .select({
      eventType: sessionEventsTable.eventType,
      runId: sessionEventsTable.runId,
      semanticHash: sessionEventsTable.semanticHash,
      seq: sessionEventsTable.seq,
      sourceEventId: sessionEventsTable.sourceEventId,
      streamId: sessionEventsTable.streamId,
      terminalEventJson: sessionEventsTable.terminalEventJson,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, sessionId),
        sql`${sessionEventsTable.runId} IN (SELECT value FROM json_each(${JSON.stringify(runIds)}))`,
        inArray(sessionEventsTable.eventType, RUN_TERMINAL_EVENT_TYPES),
      ),
    )
    .all();

  const referencesByRun = new Map<SessionRunId, TerminalReference>();
  const seenRuns = new Set<SessionRunId>();
  for (const row of terminalRows) {
    if (row.runId === null) {
      continue;
    }
    if (seenRuns.has(row.runId)) {
      throw new Error(
        `Stored assistant reference has multiple terminal events for run ${row.runId}.`,
      );
    }
    seenRuns.add(row.runId);
    if (
      (row.eventType !== "run.cancelled" &&
        row.eventType !== "run.completed" &&
        row.eventType !== "run.failed") ||
      row.sourceEventId !== createSessionRunTerminalSourceId(row.runId, row.eventType)
    ) {
      throw new Error(`Stored assistant reference has a non-canonical terminal source.`);
    }
    if (row.semanticHash === null) {
      continue;
    }
    const semanticAuthority = await readTerminalEventSemanticAuthority({
      eventJson: row.terminalEventJson,
      eventType: row.eventType,
      runId: row.runId,
      semanticHash: row.semanticHash,
      sessionId,
      sourceEventId: row.sourceEventId,
      streamId: row.streamId,
    });
    referencesByRun.set(row.runId, {
      messageId: semanticAuthority.finalMessageId,
      seq: row.seq,
    });
  }
  return referencesByRun;
}

async function scanReferenceEvents(
  database: D1Database,
  input: {
    ceilings: ReadonlyMap<SessionRunId, number>;
    includePlan?: boolean;
    messageIds?: readonly string[];
    references: readonly LightweightReference[];
    runIds?: readonly SessionRunId[];
    sessionId: SessionId;
    toolRoutes: ReadonlyMap<string, ToolRoute>;
  },
  apply: (row: ReferenceEventRow) => void,
): Promise<void> {
  const runIds = [...new Set(input.runIds ?? input.references.map((reference) => reference.runId))];
  const messageIds = [
    ...new Set(input.messageIds ?? input.references.map((reference) => reference.messageId)),
  ];
  const toolCallIds = [...new Set([...input.toolRoutes.values()].map((route) => route.toolCallId))];
  const endSeq = Math.max(...runIds.map((runId) => input.ceilings.get(runId) ?? -1));
  let afterSeq: number | null = null;

  for (;;) {
    const page = await getAppDatabase(database)
      .select({
        content_text: sessionEventsTable.contentText,
        ended_at: sessionEventsTable.endedAt,
        event_type: sessionEventsTable.eventType,
        id: sessionEventsTable.id,
        occurred_at: sessionEventsTable.occurredAt,
        process_type: sessionEventsTable.processType,
        run_id: sessionEventsTable.runId,
        seq: sessionEventsTable.seq,
        stream_id: sessionEventsTable.streamId,
        tokens: sessionEventsTable.tokens,
        tool_call_id: sessionEventsTable.toolCallId,
        tool_input_delta_json: sessionEventsTable.toolInputDeltaJson,
        tool_input_json: sessionEventsTable.toolInputJson,
        tool_name: sessionEventsTable.toolName,
        tool_output_delta_text: sessionEventsTable.toolOutputDeltaText,
        tool_output_text: sessionEventsTable.toolOutputText,
        tool_parent_message_id: sessionEventsTable.toolParentMessageId,
        tool_result_message_id: sessionEventsTable.toolResultMessageId,
        tool_status: sessionEventsTable.toolStatus,
        visibility: sessionEventsTable.visibility,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          sql`${sessionEventsTable.runId} IN (SELECT value FROM json_each(${JSON.stringify(runIds)}))`,
          lte(sessionEventsTable.seq, endSeq),
          or(
            and(
              inArray(sessionEventsTable.processType, [
                "agent.message.delta",
                THOUGHT_PROCESS_TYPE,
                USER_MESSAGE_PROCESS_TYPE,
              ]),
              sql`${sessionEventsTable.streamId} IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))`,
            ),
            and(
              eq(sessionEventsTable.eventType, "tool.call.updated"),
              eq(sessionEventsTable.visibility, "all_consumers"),
              toolCallIds.length === 0
                ? sql`0`
                : sql`${sessionEventsTable.toolCallId} IN (SELECT value FROM json_each(${JSON.stringify(toolCallIds)}))`,
            ),
            input.includePlan === false ? sql`0` : eq(sessionEventsTable.eventType, "plan.updated"),
          ),
          afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(REFERENCE_EVENT_PAGE_SIZE)
      .all();

    for (const row of page) {
      apply(row);
    }
    if (page.length < REFERENCE_EVENT_PAGE_SIZE) {
      return;
    }
    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }
}

async function discoverToolRoutes(
  database: D1Database,
  input: {
    ceilings: ReadonlyMap<SessionRunId, number>;
    references: readonly CanonicalReference[];
    sessionId: SessionId;
  },
): Promise<Map<string, ToolRoute>> {
  const runIds = [...new Set(input.references.map((reference) => reference.runId))];
  const scopes = runIds.map((runId) => ({
    endSeq: input.ceilings.get(runId) ?? -1,
    runId,
  }));
  const targetKeys = new Set(
    input.references.map((reference) => referenceKey(reference.runId, reference.messageId)),
  );
  const finalKeys = new Set(
    input.references
      .filter((reference) => reference.isFinal)
      .map((reference) => referenceKey(reference.runId, reference.messageId)),
  );
  const endSeq = Math.max(...runIds.map((runId) => input.ceilings.get(runId) ?? -1));
  const routes = new Map<string, ToolRoute>();
  let afterSeq: number | null = null;

  for (;;) {
    const page = await getAppDatabase(database)
      .select({
        run_id: sessionEventsTable.runId,
        seq: sessionEventsTable.seq,
        tool_call_id: sessionEventsTable.toolCallId,
        tool_output_delta_text: sessionEventsTable.toolOutputDeltaText,
        tool_output_text: sessionEventsTable.toolOutputText,
        tool_parent_message_id: sessionEventsTable.toolParentMessageId,
        tool_result_message_id: sessionEventsTable.toolResultMessageId,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          sql`${sessionEventsTable.runId} IN (SELECT value FROM json_each(${JSON.stringify(runIds)}))`,
          eq(sessionEventsTable.eventType, "tool.call.updated"),
          eq(sessionEventsTable.visibility, "all_consumers"),
          lte(sessionEventsTable.seq, endSeq),
          sql`EXISTS (
            SELECT 1
            FROM json_each(${JSON.stringify(scopes)}) AS scope
            WHERE json_extract(scope.value, '$.runId') = ${sessionEventsTable.runId}
              AND ${sessionEventsTable.seq} <= json_extract(scope.value, '$.endSeq')
          )`,
          afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(REFERENCE_EVENT_PAGE_SIZE)
      .all();

    for (const row of page) {
      if (
        row.run_id === null ||
        row.tool_call_id === null ||
        row.seq > (input.ceilings.get(row.run_id) ?? -1)
      ) {
        continue;
      }
      const key = toolKey(row.run_id, row.tool_call_id);
      const route = routes.get(key) ?? {
        authority: null,
        firstOutputSeq: null,
        firstParentSeq: null,
        parentMessageId: null,
        referenceKeys: new Set<string>(),
        resultMessageId: null,
        runId: row.run_id,
        toolCallId: row.tool_call_id,
      };
      mergeToolRouteIdentity(route, row);
      if (row.tool_parent_message_id !== null) {
        route.firstParentSeq ??= row.seq;
      }
      if (row.tool_output_delta_text !== null || row.tool_output_text !== null) {
        route.firstOutputSeq ??= row.seq;
      }
      routes.set(key, route);
    }
    if (page.length < REFERENCE_EVENT_PAGE_SIZE) {
      break;
    }
    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }

  for (const [key, route] of routes) {
    const parentOwnsRoute =
      route.firstParentSeq !== null &&
      (route.firstOutputSeq === null || route.firstParentSeq <= route.firstOutputSeq);
    const parentKey =
      route.parentMessageId === null ? null : referenceKey(route.runId, route.parentMessageId);
    const parentIsFinal = parentOwnsRoute && parentKey !== null && finalKeys.has(parentKey);
    const authorityMessageId = parentIsFinal ? route.parentMessageId : route.runId;
    const hasEffectiveSegment = parentOwnsRoute || route.firstOutputSeq !== null;
    if (hasEffectiveSegment && authorityMessageId !== null) {
      const matchedKey = referenceKey(route.runId, authorityMessageId);
      route.authority = parentIsFinal ? "final" : "carrier";
      if (!targetKeys.has(matchedKey)) {
        throw new Error(`Stored tool call ${route.toolCallId} has no canonical carrier.`);
      }
      route.referenceKeys.add(matchedKey);
    }
    if (route.referenceKeys.size === 0) {
      routes.delete(key);
    }
  }

  return routes;
}

async function discoverActiveRunArtifactIdentities(
  database: D1Database,
  input: {
    endSeq: number;
    runId: SessionRunId;
    sessionId: SessionId;
  },
): Promise<{ messageIds: string[]; toolRoutes: Map<string, ToolRoute> }> {
  const messageIds = new Set<string>();
  const toolRoutes = new Map<string, ToolRoute>();
  let afterSeq: number | null = null;

  for (;;) {
    const page = await getAppDatabase(database)
      .select({
        event_type: sessionEventsTable.eventType,
        process_type: sessionEventsTable.processType,
        seq: sessionEventsTable.seq,
        stream_id: sessionEventsTable.streamId,
        tool_call_id: sessionEventsTable.toolCallId,
        tool_parent_message_id: sessionEventsTable.toolParentMessageId,
        tool_result_message_id: sessionEventsTable.toolResultMessageId,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          eq(sessionEventsTable.runId, input.runId),
          lte(sessionEventsTable.seq, input.endSeq),
          or(
            and(
              inArray(sessionEventsTable.processType, [
                "agent.message.delta",
                USER_MESSAGE_PROCESS_TYPE,
              ]),
              inArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
            ),
            and(
              eq(sessionEventsTable.processType, THOUGHT_PROCESS_TYPE),
              inArray(sessionEventsTable.eventType, [...THOUGHT_EVENT_TYPES]),
            ),
            eq(sessionEventsTable.eventType, "tool.call.updated"),
          ),
          afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(REFERENCE_EVENT_PAGE_SIZE)
      .all();

    for (const row of page) {
      if (
        row.process_type === "agent.message.delta" ||
        row.process_type === THOUGHT_PROCESS_TYPE ||
        row.process_type === USER_MESSAGE_PROCESS_TYPE
      ) {
        if (row.stream_id === null) {
          throw new Error(`Stored ${row.event_type} event has no message stream identity.`);
        }
        messageIds.add(row.stream_id);
      }
      if (row.event_type !== "tool.call.updated" || row.tool_call_id === null) {
        continue;
      }
      const key = toolKey(input.runId, row.tool_call_id);
      const route = toolRoutes.get(key) ?? {
        authority: null,
        firstOutputSeq: null,
        firstParentSeq: null,
        parentMessageId: null,
        referenceKeys: new Set<string>(),
        resultMessageId: null,
        runId: input.runId,
        toolCallId: row.tool_call_id,
      };
      mergeToolRouteIdentity(route, row);
      toolRoutes.set(key, route);
      if (row.tool_parent_message_id !== null) {
        messageIds.add(row.tool_parent_message_id);
      }
      if (row.tool_result_message_id !== null) {
        messageIds.add(row.tool_result_message_id);
      }
    }
    if (page.length < REFERENCE_EVENT_PAGE_SIZE) {
      return {
        messageIds: [...messageIds],
        toolRoutes: new Map(
          [...toolRoutes].filter(
            ([, route]) => route.parentMessageId !== null || route.resultMessageId !== null,
          ),
        ),
      };
    }
    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }
}

async function applyStoredSessionStateArtifacts(
  database: D1Database,
  input: {
    endSeq: number;
    sessionId: SessionId;
    state: SessionLiveState;
  },
): Promise<SessionLiveState> {
  let state = input.state;
  let afterSeq: number | null = null;

  for (;;) {
    const page = await getAppDatabase(database)
      .select({
        content_text: sessionEventsTable.contentText,
        event_type: sessionEventsTable.eventType,
        seq: sessionEventsTable.seq,
        visibility: sessionEventsTable.visibility,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          inArray(sessionEventsTable.eventType, [
            ...ACTIVE_SESSION_STATE_EVENT_TYPES,
            "plan.updated",
          ]),
          lte(sessionEventsTable.seq, input.endSeq),
          afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(REFERENCE_EVENT_PAGE_SIZE)
      .all();
    for (const row of page) {
      state = applyAgUiEventToSessionLiveState(state, sessionStateAgUiEvent(row));
    }
    if (page.length < REFERENCE_EVENT_PAGE_SIZE) {
      return state;
    }
    afterSeq = page[page.length - 1]?.seq ?? afterSeq;
  }
}

export async function applyStoredSessionArtifacts(
  database: D1Database,
  input: {
    endSeq: number;
    includeActiveRunArtifacts: boolean;
    runId: SessionRunId | null;
    sessionId: SessionId;
    state: SessionLiveState;
  },
): Promise<SessionLiveState> {
  const metadataState = await applyStoredSessionStateArtifacts(database, input);
  if (input.runId === null || !input.includeActiveRunArtifacts) {
    return metadataState;
  }

  const { messageIds, toolRoutes } = await discoverActiveRunArtifactIdentities(database, {
    endSeq: input.endSeq,
    runId: input.runId,
    sessionId: input.sessionId,
  });
  const state: ReferenceState = {
    isCarrier: false,
    isFinal: true,
    live: metadataState,
    message: createMessageStreamReducerState(),
    planJson: null,
  };
  const activeKey = referenceKey(input.runId, "$active");
  const states = new Map<string, ReferenceState>([[activeKey, state]]);
  for (const messageId of messageIds) {
    states.set(referenceKey(input.runId, messageId), state);
  }
  for (const route of toolRoutes.values()) {
    route.referenceKeys.add(activeKey);
  }
  const ceilings = new Map<SessionRunId, number>([[input.runId, input.endSeq]]);
  const statesByRun = new Map<SessionRunId, ReferenceState[]>([[input.runId, [state]]]);

  await scanReferenceEvents(
    database,
    {
      ceilings,
      includePlan: false,
      messageIds,
      references: [],
      runIds: [input.runId],
      sessionId: input.sessionId,
      toolRoutes,
    },
    (row) => {
      applyReferenceEvent(states, statesByRun, ceilings, toolRoutes, row, {
        activeArtifacts: true,
      });
    },
  );

  return state.live;
}

async function readSealedReferenceCursor(
  database: D1Database,
  input: {
    endSeq: number;
    reference: LightweightReference;
    sessionId: SessionId;
  },
): Promise<SealedReferenceCursor | null> {
  const databaseClient = getAppDatabase(database);
  const scope = [
    eq(sessionEventsTable.sessionId, input.sessionId),
    eq(sessionEventsTable.runId, input.reference.runId),
    eq(sessionEventsTable.streamId, input.reference.messageId),
    eq(sessionEventsTable.processType, "agent.message.delta"),
    lte(sessionEventsTable.seq, input.endSeq),
  ];
  const [invalid, latest, boundary] = await Promise.all([
    databaseClient
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          ...scope,
          or(
            ne(sessionEventsTable.visibility, "all_consumers"),
            notInArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
          ),
        ),
      )
      .limit(1)
      .get(),
    databaseClient
      .select({ eventType: sessionEventsTable.eventType, seq: sessionEventsTable.seq })
      .from(sessionEventsTable)
      .where(and(...scope, inArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES])))
      .orderBy(desc(sessionEventsTable.seq))
      .limit(1)
      .get(),
    databaseClient
      .select({ eventType: sessionEventsTable.eventType, seq: sessionEventsTable.seq })
      .from(sessionEventsTable)
      .where(
        and(
          ...scope,
          inArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_AUTHORITY_BOUNDARY_EVENT_TYPES]),
        ),
      )
      .orderBy(desc(sessionEventsTable.seq))
      .limit(1)
      .get(),
  ]);
  if (invalid !== undefined) {
    throw new Error(`Stored assistant reference ${input.reference.messageId} is not public.`);
  }
  return latest?.eventType === "message.completed" && boundary?.eventType === "message.added"
    ? { endSeq: latest.seq, startSeq: boundary.seq }
    : null;
}

async function readBoundedReferenceContent(
  database: D1Database,
  input: {
    cursor: SealedReferenceCursor;
    maxTextLength: number;
    reference: LightweightReference;
    sessionId: SessionId;
  },
): Promise<string> {
  const state = createContentReferenceState();
  if (input.maxTextLength === 0) {
    return "";
  }
  let afterSeq: number | null = null;

  for (;;) {
    const filters: (SQL | undefined)[] = [
      eq(sessionEventsTable.sessionId, input.sessionId),
      eq(sessionEventsTable.runId, input.reference.runId),
      eq(sessionEventsTable.processType, "agent.message.delta"),
      eq(sessionEventsTable.streamId, input.reference.messageId),
      gte(sessionEventsTable.seq, input.cursor.startSeq),
      lte(sessionEventsTable.seq, input.cursor.endSeq),
      afterSeq === null ? undefined : gt(sessionEventsTable.seq, afterSeq),
    ];
    const metadata: { contentLength: number; seq: number }[] = await getAppDatabase(database)
      .select({
        contentLength: sql<number>`length(${sessionEventsTable.contentText})`,
        seq: sessionEventsTable.seq,
      })
      .from(sessionEventsTable)
      .where(and(...filters))
      .orderBy(asc(sessionEventsTable.seq))
      .limit(BOUNDED_REFERENCE_EVENT_PAGE_SIZE)
      .all();
    if (metadata.length === 0) {
      throw new Error(`Stored assistant reference ${input.reference.messageId} has no content.`);
    }
    let pageChars = 0;
    let pageRowCount = 0;
    for (const row of metadata) {
      if (pageRowCount > 0 && pageChars + row.contentLength > BOUNDED_REFERENCE_EVENT_PAGE_CHARS) {
        break;
      }
      pageChars += row.contentLength;
      pageRowCount += 1;
    }
    const pageEndSeq: number | undefined = metadata[pageRowCount - 1]?.seq;
    if (pageEndSeq === undefined) {
      throw new Error(`Stored assistant reference ${input.reference.messageId} has no content.`);
    }
    const page = await getAppDatabase(database)
      .select({
        content_text: sessionEventsTable.contentText,
        ended_at: sessionEventsTable.endedAt,
        event_type: sessionEventsTable.eventType,
        id: sessionEventsTable.id,
        occurred_at: sessionEventsTable.occurredAt,
        process_type: sessionEventsTable.processType,
        run_id: sessionEventsTable.runId,
        seq: sessionEventsTable.seq,
        stream_id: sessionEventsTable.streamId,
        tokens: sessionEventsTable.tokens,
        visibility: sessionEventsTable.visibility,
      })
      .from(sessionEventsTable)
      .where(and(...filters, lte(sessionEventsTable.seq, pageEndSeq)))
      .orderBy(asc(sessionEventsTable.seq))
      .all();

    for (const row of page) {
      reduceSanitizedMessageStreamRow(state, row, input.maxTextLength);
      if (state.message.text.length >= input.maxTextLength) {
        return state.message.text;
      }
    }
    if (
      pageEndSeq === input.cursor.endSeq ||
      (pageRowCount === metadata.length && metadata.length < BOUNDED_REFERENCE_EVENT_PAGE_SIZE)
    ) {
      if (!state.message.authoritative || !state.message.sealed) {
        throw new Error(
          `Stored assistant reference ${input.reference.messageId} is not sealed and authoritative.`,
        );
      }
      return state.message.text;
    }
    afterSeq = pageEndSeq;
  }
}

async function assertReferenceMessageIdentities(
  database: D1Database,
  input: {
    ceilings: ReadonlyMap<SessionRunId, number>;
    references: readonly LightweightReference[];
    sessionId: SessionId;
  },
): Promise<void> {
  const scopes = input.references.map((reference) => ({
    endSeq: input.ceilings.get(reference.runId) ?? -1,
    messageId: reference.messageId,
    runId: reference.runId,
  }));
  const collision = await getAppDatabase(database)
    .select({ id: sessionEventsTable.id })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        inArray(sessionEventsTable.eventType, [...MESSAGE_STREAM_EVENT_TYPES]),
        sql`EXISTS (
          SELECT 1
          FROM json_each(${JSON.stringify(scopes)}) AS scope
          WHERE json_extract(scope.value, '$.messageId') = ${sessionEventsTable.streamId}
            AND ${sessionEventsTable.seq} <= json_extract(scope.value, '$.endSeq')
            AND (
              ${sessionEventsTable.runId} IS NOT json_extract(scope.value, '$.runId')
              OR ${sessionEventsTable.processType} <> 'agent.message.delta'
            )
        )`,
      ),
    )
    .limit(1)
    .get();

  if (collision !== undefined) {
    throw new Error("Stored assistant reference has conflicting message-stream identity rows.");
  }
}

export async function resolveStoredSessionMessageContentReferences<
  Row extends StoredSessionMessageContentReferenceRow,
>(
  database: D1Database,
  sessionId: SessionId,
  rows: readonly Row[],
  maxTextLength: number,
): Promise<Row[]> {
  for (const row of rows) {
    if (
      row.projection_format === "event_stream_v3" &&
      (row.role !== "assistant" || row.session_run_id === null || row.content_text !== "")
    ) {
      throw new Error(`Stored event-stream assistant ${row.id} is not lightweight.`);
    }
  }
  const candidates = rows.flatMap((row): LightweightReference[] => {
    const reference = potentialReference(row);
    return reference === null ? [] : [reference];
  });
  if (candidates.length === 0) {
    return [...rows];
  }
  const terminalReferences = await readTerminalReferences(
    database,
    sessionId,
    candidates.map((candidate) => candidate.runId),
  );
  const references = requireTerminalReferences(candidates, terminalReferences);
  const ceilings = new Map(
    references.map((reference) => [reference.runId, terminalReferences.get(reference.runId)!.seq]),
  );
  const finalReferences = references.filter((reference) => reference.isFinal);
  await assertReferenceMessageIdentities(database, {
    ceilings,
    references: finalReferences,
    sessionId,
  });
  const resolvedText = new Map<string, string>();
  for (const reference of finalReferences) {
    const endSeq = ceilings.get(reference.runId);
    if (endSeq === undefined) {
      throw new Error(
        `Stored event-stream assistant ${reference.messageId} has no terminal ceiling.`,
      );
    }
    const cursor = await readSealedReferenceCursor(database, {
      endSeq,
      reference,
      sessionId,
    });
    if (cursor === null) {
      throw new Error(
        `Stored assistant reference ${reference.messageId} is not sealed and authoritative.`,
      );
    }
    resolvedText.set(
      referenceKey(reference.runId, reference.messageId),
      await readBoundedReferenceContent(database, {
        cursor,
        maxTextLength,
        reference,
        sessionId,
      }),
    );
  }

  return rows.map((row) => {
    if (row.session_run_id === null) {
      return row;
    }
    const contentText = resolvedText.get(referenceKey(row.session_run_id, row.id));
    if (contentText === undefined) {
      return row;
    }
    return { ...row, content_text: contentText };
  });
}

async function resolveStoredSessionMessageSnapshot<Row extends StoredSessionMessageReferenceRow>(
  database: D1Database,
  sessionId: SessionId,
  rows: readonly Row[],
): Promise<Row[]> {
  for (const row of rows) {
    if (
      row.projection_format === "event_stream_v3" &&
      (row.role !== "assistant" ||
        row.session_run_id === null ||
        row.content_text !== "" ||
        row.plan_json !== null ||
        row.segments_json !== null)
    ) {
      throw new Error(`Stored event-stream assistant ${row.id} is not lightweight.`);
    }
  }
  const candidates = rows.flatMap((row): LightweightReference[] => {
    const reference = potentialReference(row);
    return reference === null ? [] : [reference];
  });
  if (candidates.length === 0) {
    return [...rows];
  }
  const terminalReferences = await readTerminalReferences(
    database,
    sessionId,
    candidates.map((candidate) => candidate.runId),
  );
  const references = requireTerminalReferences(candidates, terminalReferences);
  const ceilings = new Map(
    references.map((reference) => [reference.runId, terminalReferences.get(reference.runId)!.seq]),
  );
  await assertReferenceMessageIdentities(database, {
    ceilings,
    references: references.filter((reference) => reference.isFinal),
    sessionId,
  });
  const states = new Map<string, ReferenceState>();
  const statesByRun = new Map<SessionRunId, ReferenceState[]>();
  for (const reference of references) {
    const state = createReferenceState(sessionId, reference);
    states.set(referenceKey(reference.runId, reference.messageId), state);
    if (reference.isFinal) {
      const runStates = statesByRun.get(reference.runId) ?? [];
      runStates.push(state);
      statesByRun.set(reference.runId, runStates);
    }
  }

  const toolRoutes = await discoverToolRoutes(database, { ceilings, references, sessionId });
  await scanReferenceEvents(database, { ceilings, references, sessionId, toolRoutes }, (row) =>
    applyReferenceEvent(states, statesByRun, ceilings, toolRoutes, row),
  );

  return rows.map((row) => {
    if (row.session_run_id === null) {
      return row;
    }
    const state = states.get(referenceKey(row.session_run_id, row.id));
    if (state === undefined) {
      return row;
    }
    if (state.isFinal && (!state.message.authoritative || !state.message.sealed)) {
      throw new Error(`Stored assistant reference ${row.id} is not sealed and authoritative.`);
    }
    const message = state.live.messages.find((candidate) => candidate.id === row.id);
    if (
      message === undefined ||
      (state.isFinal && message.content !== state.message.text) ||
      (!state.isFinal && message.content !== "") ||
      (!state.isFinal &&
        !message.segments.some(
          (segment) => segment.kind === "tool_result" || segment.kind === "tool_use",
        ))
    ) {
      throw new Error(`Stored assistant reference ${row.id} diverges from the live reducer.`);
    }
    if (state.live.messages.some((candidate) => candidate.id !== row.id)) {
      throw new Error(`Stored assistant reference ${row.id} produced a detached message.`);
    }

    return {
      ...row,
      content_text: state.isFinal ? state.message.text : "",
      plan_json: state.isFinal ? state.planJson : null,
      segments_json: JSON.stringify(message.segments),
    };
  });
}

export async function resolveStoredSessionMessageReferences<
  Row extends StoredSessionMessageReferenceRow,
>(database: D1Database, sessionId: SessionId, rows: readonly Row[]): Promise<Row[]> {
  return resolveStoredSessionMessageSnapshot(database, sessionId, rows);
}

export async function resolveStoredSessionMessageSnapshotReferences<
  Row extends StoredSessionMessageReferenceRow,
>(database: D1Database, sessionId: SessionId, rows: readonly Row[]): Promise<Row[]> {
  return resolveStoredSessionMessageSnapshot(database, sessionId, rows);
}
