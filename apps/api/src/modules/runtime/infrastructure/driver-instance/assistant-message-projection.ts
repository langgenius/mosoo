import type { SessionMessageSegment } from "@mosoo/contracts/session";
import { sessionEventsTable, sessionMessagesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  PlatformId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import {
  parseRuntimeEventEnvelope,
  readRuntimeEventMessageContent,
  readRuntimeEventMessageDelta,
  readRuntimeEventMessageRole,
} from "@mosoo/runtime-events";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type {
  SessionLiveState,
  SessionLiveStateMessage,
  SessionViewSegment,
} from "../../../sessions/application/session-live-state.service";
import { prepareSessionMessageInsert } from "../../../sessions/infrastructure/session-message-store.repository";
import type { PreparedSessionMessageInsert } from "../../../sessions/infrastructure/session-message-store.repository";

function toSessionMessageSegments(segments: SessionViewSegment[]): SessionMessageSegment[] {
  const result: SessionMessageSegment[] = [];

  for (const segment of segments) {
    switch (segment.kind) {
      case "text": {
        result.push({ kind: "text", text: segment.text });
        break;
      }
      case "reasoning": {
        break;
      }
      case "tool_use": {
        result.push({
          argsText: segment.argsText,
          kind: "tool_use",
          path: segment.path,
          tool: segment.tool,
          toolCallId: segment.toolCallId,
        });
        break;
      }
      case "tool_result": {
        result.push({
          kind: "tool_result",
          output: segment.output,
          tool: segment.tool,
          toolCallId: segment.toolCallId,
        });
        break;
      }
      default: {
        const exhaustiveSegment: never = segment;

        throw new Error(`Unsupported session segment kind: ${String(exhaustiveSegment)}`);
      }
    }
  }

  return result;
}

function findAssistantMessage(
  messages: SessionLiveStateMessage[],
  messageId: string,
): SessionLiveStateMessage | null {
  return (
    messages.find((message) => message.id === messageId && message.role === "assistant") ?? null
  );
}

export async function readDurableFinalAssistantMessageSnapshot(
  database: D1Database,
  input: { messageId: string; sessionId: SessionId; sessionRunId: SessionRunId },
): Promise<{ id: string; text: string } | null> {
  const rows = await getAppDatabase(database)
    .select({ canonicalEventJson: sessionEventsTable.canonicalEventJson })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.runId, input.sessionRunId),
        inArray(sessionEventsTable.eventType, [
          "message.added",
          "message.started",
          "message.delta",
          "message.completed",
          "message.cancelled",
          "message.failed",
        ]),
        sql`json_extract(${sessionEventsTable.canonicalEventJson}, '$.payload.messageId') = ${input.messageId}`,
      ),
    )
    .orderBy(asc(sessionEventsTable.seq))
    .all();
  let snapshot: string | null = null;
  let completed = false;
  for (const row of rows) {
    if (row.canonicalEventJson === null) continue;
    // These rows are message events; timing payloads use a separate host projection.
    const event = parseRuntimeEventEnvelope(JSON.parse(row.canonicalEventJson));
    if (
      event.runId !== input.sessionRunId ||
      event.sessionId !== input.sessionId ||
      readRuntimeEventMessageRole(event) === "user"
    )
      return null;
    switch (event.kind) {
      case "message.started": {
        snapshot = null;
        completed = false;
        break;
      }
      case "message.added": {
        snapshot = readRuntimeEventMessageContent(event) ?? "";
        completed = false;
        break;
      }
      case "message.delta": {
        if (snapshot !== null) snapshot += readRuntimeEventMessageDelta(event);
        completed = false;
        break;
      }
      case "message.completed": {
        completed = snapshot !== null;
        break;
      }
      default: {
        completed = false;
      }
    }
  }
  return completed && snapshot !== null ? { id: input.messageId, text: snapshot } : null;
}

export interface AssistantMessageProjectionInput {
  createdByAccountId: PlatformId;
  driverInstanceId: DriverInstanceId;
  messageId: string;
  messageText: string;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  state: SessionLiveState;
}

export async function prepareAssistantMessageProjection(
  database: D1Database,
  input: AssistantMessageProjectionInput,
): Promise<PreparedSessionMessageInsert | null> {
  const message = findAssistantMessage(input.state.messages, input.messageId);
  const useStructuredProjection = message?.content === input.messageText;

  if (message !== null && !useStructuredProjection) {
    logWarn("runtime.assistant.message.snapshot_mismatch", {
      driverInstanceId: input.driverInstanceId,
      finalMessageId: input.messageId,
      projectedTextLength: message.content.length,
      reason: "Durable final assistant snapshot did not match the live projection",
      sessionId: input.sessionId,
      sessionRunId: input.sessionRunId,
      snapshotTextLength: input.messageText.length,
    });
  }

  const messageId = parsePlatformId<SessionMessageId>(input.messageId, "assistant message id");
  const plan = useStructuredProjection && message !== null ? message.plan : [];
  const segments =
    useStructuredProjection && message !== null
      ? toSessionMessageSegments(message.segments)
      : [{ kind: "text" as const, text: input.messageText }];
  const persistedMessage = await readPersistedAssistantMessage(database, input.sessionRunId);

  if (persistedMessage !== null) {
    if (persistedMessage.id !== messageId || persistedMessage.content !== input.messageText) {
      throw new Error(
        `Canonical final assistant message conflicts with the persisted projection for run ${input.sessionRunId}.`,
      );
    }

    // A replay must preserve both the selected message identity and its text.
    return null;
  }

  logInfo("runtime.assistant.message.persisting", {
    driverInstanceId: input.driverInstanceId,
    planEntries: plan.length,
    segmentCount: segments.length,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
    textLength: input.messageText.length,
  });

  return prepareSessionMessageInsert(database, {
    content: input.messageText,
    createdByAccountId: input.createdByAccountId,
    id: messageId,
    plan,
    role: "assistant",
    segments,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  });
}

async function readPersistedAssistantMessage(
  database: D1Database,
  sessionRunId: SessionRunId,
): Promise<{ content: string; id: SessionMessageId } | null> {
  const row =
    (await getAppDatabase(database)
      .select({ content: sessionMessagesTable.contentText, id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionRunId, sessionRunId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .orderBy(desc(sessionMessagesTable.seq))
      .limit(1)
      .get()) ?? null;

  return row;
}
