import { OpenAiPrivateCitationStreamFilter } from "@mosoo/agent-driver/provider-output";
import type {
  PublicThreadApiListThreadEventsResponse,
  PublicThreadEventLogEntry,
  PublicThreadEventLogType,
  PublicThreadFinalOutput,
} from "@mosoo/contracts/public-api";
import {
  PUBLIC_THREAD_EVENT_LOG_TYPES,
  PUBLIC_THREAD_EVENTS_MAX_LIMIT,
} from "@mosoo/contracts/public-api";
import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { parseJsonObject } from "@mosoo/contracts/validation";
import type { JsonObject } from "@mosoo/contracts/validation";
import { sessionEventsTable, sessionMessagesTable, sessionRunsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionMessageId, SessionRunId } from "@mosoo/id";
import { createSessionRunTerminalSourceId } from "@mosoo/runtime-events";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../platform/cloudflare/logger";
import { getAppDatabase } from "../../platform/db/drizzle";
import { createSessionProcessEventsFromSessionEventRows } from "../sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../sessions/application/session-process-events.service";
import {
  excludeSessionEventStreams,
  findLeftIncompleteSessionEventStreamKeys,
  foldStreamedSessionEventRows,
  getMessageStreamTextFragment,
  getSessionEventStreamKey,
} from "../sessions/domain/session-event-stream-fold";
import { readTerminalEventSemanticAuthority } from "../sessions/domain/session-terminal-event-authority";
import type { SessionMessageEventStreamCursor } from "../sessions/infrastructure/session-message-event-stream.repository";
import {
  iteratePublicSessionMessageEventRows,
  readSealedPublicSessionMessage,
} from "../sessions/infrastructure/session-message-event-stream.repository";
import { connectSessionPublicEventWebSocket } from "../sessions/infrastructure/session/client";
import { publicInternalError, publicInvalidRequest, toPublicApiError } from "./public-api-errors";
import { sanitizePublicOutput } from "./public-output-sanitization";
import { admitPublicThreadReader } from "./public-thread-admission";
import { toBackingSessionId } from "./public-thread-ids";
import { getThreadSnapshot } from "./public-thread-store";
import type {
  ListPublicThreadEventsRequest,
  StreamPublicThreadEventsRequest,
} from "./public-thread.types";

const THREAD_EVENT_ROW_PAGE_SIZE = PUBLIC_THREAD_EVENTS_MAX_LIMIT;
const THREAD_EVENT_RAW_ROW_SCAN_LIMIT = PUBLIC_THREAD_EVENTS_MAX_LIMIT * 20;
const THREAD_EVENT_STREAM_POLL_INTERVAL_MS = 2_000;
const THREAD_EVENT_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;
const PUBLIC_THREAD_EVENT_LOG_TYPE_SET: ReadonlySet<string> = new Set(
  PUBLIC_THREAD_EVENT_LOG_TYPES,
);
const SSE_TEXT_ENCODER = new TextEncoder();

interface PublicThreadEventWindow {
  events: PublicThreadEventLogEntry[];
  leftIncompleteStreamKeys: Set<string>;
  latestSeq: number | null;
  rows: PublicThreadEventProcessRow[];
  trustUnknownMessageDeltas: boolean;
  truncated: boolean;
}

interface PublicThreadEventProcessRow extends SessionEventProcessRow {
  run_id: SessionRunId | null;
  tool_call_id: string | null;
  tool_input_json: string | null;
  tool_name: string | null;
  tool_status: "cancelled" | "completed" | "failed" | "running" | null;
}

interface LiveMessageSnapshot {
  endSeq: number;
  row: PublicThreadEventProcessRow;
  sealed: boolean;
  startSeq: number;
}

interface LiveMessageState {
  draftEndSeq: number;
  draftFilter: OpenAiPrivateCitationStreamFilter;
  draftProjectedChars: number;
  draftStartSeq: number;
  emittedCursor: SessionMessageEventStreamCursor | null;
  firstOccurredAt: number;
  firstSeq: number;
  messageTerminal: boolean;
  runId: SessionRunId | null;
  runTerminal: boolean;
  snapshot: LiveMessageSnapshot | null;
  trusted: boolean;
}

interface PublicMessageReconciliationRequest {
  candidateCursor: SessionMessageEventStreamCursor;
  emittedCursor: SessionMessageEventStreamCursor | null;
  key: string;
  outputRow: PublicThreadEventProcessRow;
  sourceRow: PublicThreadEventProcessRow;
}

interface PublicMessageReconciliationResult {
  compatible: boolean;
  emitted: boolean;
}

function projectPublicMessageText(text: string, finish: boolean): string {
  const filter = new OpenAiPrivateCitationStreamFilter();
  const projected = filter.push(text).text;
  return finish ? projected + filter.finish().text : projected;
}

class PublicLiveEventRowProjector {
  #isSeeding = false;
  readonly #messages = new Map<string, LiveMessageState>();
  readonly #trustedUnknownDeltaRuns = new Set<SessionRunId>();
  #trustUnknownMessageDeltas = true;

  seedFromCanonicalEvents(
    rows: readonly PublicThreadEventProcessRow[],
    events: readonly PublicThreadEventLogEntry[],
    leftIncompleteStreamKeys: ReadonlySet<string> = new Set(),
    trustUnknownMessageDeltas = true,
  ): PublicThreadEventLogEntry[] {
    this.#trustUnknownMessageDeltas = trustUnknownMessageDeltas;
    for (const row of rows) {
      if (row.process_type !== "agent.message.delta" || !row.event_type.startsWith("message.")) {
        continue;
      }
      const key = this.#getMessageKey(row);
      if (leftIncompleteStreamKeys.has(key) && !this.#messages.has(key)) {
        this.#messages.set(key, this.#createMessage(row, false));
      }
    }

    this.#isSeeding = true;
    try {
      this.project(rows);
    } finally {
      this.#isSeeding = false;
    }

    const rowsByEventId = new Map(rows.map((row) => [row.id, row]));
    return events.map((event) => {
      const row = rowsByEventId.get(event.id);
      if (row?.event_type.startsWith("message.") !== true) {
        return event;
      }

      const message = this.#messages.get(this.#getMessageKey(row));
      if (message === undefined) {
        return event;
      }

      const cursor = this.#currentCursor(message);
      message.emittedCursor = cursor;
      const content = projectPublicMessageText(event.content, cursor.finish);
      return content === event.content ? event : { ...event, content };
    });
  }

  getReconciliationRequests(
    row: PublicThreadEventProcessRow,
  ): PublicMessageReconciliationRequest[] {
    if (row.event_type === "message.completed") {
      const key = this.#getMessageKey(row);
      const message = this.#messages.get(key);
      if (
        message?.snapshot === null ||
        message?.snapshot === undefined ||
        message.runTerminal ||
        message.snapshot.sealed ||
        !message.trusted
      ) {
        return [];
      }
      return [this.#createReconciliationRequest(key, message, row, true)];
    }

    if (
      row.event_type !== "run.cancelled" &&
      row.event_type !== "run.completed" &&
      row.event_type !== "run.failed"
    ) {
      return [];
    }

    const requests: PublicMessageReconciliationRequest[] = [];
    for (const [key, message] of this.#messages) {
      if (
        message.runId === row.run_id &&
        message.snapshot !== null &&
        !message.snapshot.sealed &&
        !message.runTerminal &&
        message.trusted
      ) {
        requests.push(this.#createReconciliationRequest(key, message, row, false));
      }
    }
    return requests;
  }

  project(
    rows: readonly PublicThreadEventProcessRow[],
    reconciled: ReadonlyMap<string, PublicMessageReconciliationResult> = new Map(),
  ): PublicThreadEventProcessRow[] {
    const output: PublicThreadEventProcessRow[] = [];

    for (const row of rows) {
      if (row.event_type === "message.started") {
        const key = this.#getMessageKey(row);
        if (!this.#messages.has(key)) {
          this.#messages.set(key, this.#createMessage(row));
        }
        continue;
      }

      if (row.event_type === "message.delta") {
        const key = this.#getMessageKey(row);
        let message = this.#messages.get(key);
        if (message === undefined) {
          const runBoundaryIsTrusted =
            row.run_id !== null && this.#trustedUnknownDeltaRuns.has(row.run_id);
          if (
            !this.#trustUnknownMessageDeltas &&
            !runBoundaryIsTrusted &&
            row.stream_id !== row.id
          ) {
            continue;
          }
          message = this.#createMessage(row);
          this.#messages.set(key, message);
        }
        if (!message.trusted) {
          continue;
        }
        if (message.snapshot !== null) {
          message.snapshot.endSeq = row.seq;
          message.snapshot.sealed = false;
          message.messageTerminal = false;
          continue;
        }

        const projectedBefore = message.draftProjectedChars;
        const contentText = message.draftFilter.push(row.content_text).text;
        message.draftEndSeq = row.seq;
        message.draftProjectedChars += contentText.length;
        message.messageTerminal = false;
        if (contentText.length > 0) {
          this.#recordDraftOutput(message, row.seq, projectedBefore);
          output.push({ ...row, content_text: contentText });
        }
        continue;
      }

      if (row.event_type === "message.added") {
        const key = this.#getMessageKey(row);
        let message = this.#messages.get(key);
        if (message === undefined && row.process_type === "agent.message.delta") {
          message = this.#createMessage(row);
          this.#messages.set(key, message);
        }
        if (message === undefined) {
          output.push({ ...row, content_text: sanitizePublicOutput(row.content_text).text });
          continue;
        }
        if (message.runTerminal && !this.#isSeeding) {
          message.trusted = false;
          continue;
        }
        message.trusted = true;
        message.messageTerminal = false;
        message.snapshot = {
          endSeq: row.seq,
          row: { ...row, content_text: "" },
          sealed: false,
          startSeq: row.seq,
        };
        continue;
      }

      if (
        row.event_type === "message.cancelled" ||
        row.event_type === "message.completed" ||
        row.event_type === "message.failed"
      ) {
        const key = this.#getMessageKey(row);
        const message = this.#messages.get(key);
        if (message === undefined || message.runTerminal) {
          if (message === undefined) {
            output.push({ ...row, content_text: "" });
          }
          continue;
        }
        if (!message.trusted && message.snapshot === null) {
          message.messageTerminal = true;
          continue;
        }
        const wasTerminal = message.messageTerminal;
        let contentText = "";
        if (row.event_type === "message.completed" && message.snapshot !== null) {
          message.snapshot.endSeq = row.seq;
          message.snapshot.sealed = true;
          if (!this.#isSeeding) {
            const compatible = reconciled.get(key)?.compatible === true;
            message.trusted = compatible;
            if (compatible) {
              message.emittedCursor = this.#snapshotCursor(message.snapshot, true);
            }
          }
        } else {
          message.snapshot = null;
          if (!this.#isSeeding) {
            contentText = message.draftFilter.finish().text;
            const projectedBefore = message.draftProjectedChars;
            message.draftProjectedChars += contentText.length;
            message.draftEndSeq = row.seq;
            if (contentText.length > 0) {
              this.#recordDraftOutput(message, row.seq, projectedBefore);
            }
            if (message.emittedCursor?.startSeq === message.draftStartSeq) {
              message.emittedCursor = { ...message.emittedCursor, endSeq: row.seq, finish: true };
            }
          }
          message.trusted = row.event_type === "message.completed";
        }
        message.messageTerminal = true;
        if ((!wasTerminal || contentText.length > 0) && reconciled.get(key)?.emitted !== true) {
          output.push({ ...row, content_text: contentText });
        }
        continue;
      }

      if (
        row.event_type === "thought.cancelled" ||
        row.event_type === "thought.completed" ||
        row.event_type === "thought.started"
      ) {
        continue;
      }

      if (
        row.event_type === "run.cancelled" ||
        row.event_type === "run.completed" ||
        row.event_type === "run.failed"
      ) {
        for (const [key, message] of this.#messages) {
          if (message.runId !== row.run_id) {
            continue;
          }
          if (message.snapshot !== null && !message.snapshot.sealed && !this.#isSeeding) {
            const compatible = reconciled.get(key)?.compatible === true;
            message.trusted = compatible;
            if (compatible) {
              message.emittedCursor = this.#snapshotCursor(message.snapshot, false);
            }
          }
          message.runTerminal = true;
        }
        if (row.run_id !== null) {
          this.#trustedUnknownDeltaRuns.delete(row.run_id);
        }
        output.push(row);
        continue;
      }

      if (row.event_type === "run.started") {
        let released = false;
        for (const [key, message] of this.#messages) {
          if (message.runId !== row.run_id) {
            this.#messages.delete(key);
            released = true;
          }
        }
        if (released) {
          this.#trustUnknownMessageDeltas = false;
        }
        if (row.run_id !== null) {
          this.#trustedUnknownDeltaRuns.clear();
          this.#trustedUnknownDeltaRuns.add(row.run_id);
        }
      }

      output.push(row);
    }

    return output;
  }

  #createMessage(row: PublicThreadEventProcessRow, trusted = true): LiveMessageState {
    return {
      draftEndSeq: row.seq,
      draftFilter: new OpenAiPrivateCitationStreamFilter(),
      draftProjectedChars: 0,
      draftStartSeq: row.seq,
      emittedCursor: null,
      firstOccurredAt: row.occurred_at,
      firstSeq: row.seq,
      messageTerminal: false,
      runId: row.run_id,
      runTerminal: false,
      snapshot: null,
      trusted,
    };
  }

  #getMessageKey(row: PublicThreadEventProcessRow): string {
    const key = getSessionEventStreamKey(row);
    if (key === null) {
      throw new Error(`Persisted ${row.event_type} event is missing its stream ID.`);
    }
    return key;
  }

  #currentCursor(message: LiveMessageState): SessionMessageEventStreamCursor {
    return message.snapshot === null
      ? {
          endSeq: message.draftEndSeq,
          finish: message.messageTerminal,
          outputOffset: 0,
          startSeq: message.draftStartSeq,
        }
      : this.#snapshotCursor(message.snapshot, message.snapshot.sealed);
  }

  #snapshotCursor(snapshot: LiveMessageSnapshot, finish: boolean): SessionMessageEventStreamCursor {
    return {
      endSeq: snapshot.endSeq,
      finish,
      outputOffset: 0,
      startSeq: snapshot.startSeq,
    };
  }

  #createReconciliationRequest(
    key: string,
    message: LiveMessageState,
    boundaryRow: PublicThreadEventProcessRow,
    finish: boolean,
  ): PublicMessageReconciliationRequest {
    const snapshot = message.snapshot;
    if (snapshot === null) {
      throw new Error("Cannot reconcile a message without an authoritative snapshot.");
    }
    return {
      candidateCursor: {
        ...this.#snapshotCursor(snapshot, finish),
        endSeq: finish ? boundaryRow.seq : snapshot.endSeq,
      },
      emittedCursor: message.emittedCursor,
      key,
      outputRow: {
        ...(finish ? boundaryRow : snapshot.row),
        event_type: "message.delta",
        occurred_at: message.firstOccurredAt,
        seq: message.firstSeq,
      },
      sourceRow: snapshot.row,
    };
  }

  #recordDraftOutput(message: LiveMessageState, endSeq: number, outputOffset: number): void {
    if (message.emittedCursor === null) {
      message.emittedCursor = {
        endSeq,
        finish: false,
        outputOffset,
        startSeq: message.draftStartSeq,
      };
    } else if (message.emittedCursor.startSeq === message.draftStartSeq) {
      message.emittedCursor = { ...message.emittedCursor, endSeq, finish: false };
    }
  }
}

interface ProjectedMessageChunk {
  row: PublicThreadEventProcessRow;
  text: string;
}

async function* iterateProjectedMessageChunks(input: {
  cursor: SessionMessageEventStreamCursor;
  database: D1Database;
  row: PublicThreadEventProcessRow;
  sessionId: SessionId;
}): AsyncGenerator<ProjectedMessageChunk> {
  if (input.row.stream_id === null) {
    throw new Error(`Persisted ${input.row.event_type} event is missing its stream ID.`);
  }

  let filter = new OpenAiPrivateCitationStreamFilter();
  let lastContentRow: PublicThreadEventProcessRow | null = null;
  let outputOffset = input.cursor.outputOffset;
  let pending: ProjectedMessageChunk | null = null;

  for await (const row of iteratePublicSessionMessageEventRows(input.database, {
    cursor: input.cursor,
    processType: input.row.process_type,
    runId: input.row.run_id,
    sessionId: input.sessionId,
    streamId: input.row.stream_id,
  })) {
    const fragment = getMessageStreamTextFragment(row);
    if (fragment === null) {
      continue;
    }
    if (fragment.kind === "reset") {
      filter = new OpenAiPrivateCitationStreamFilter();
    }

    const projectedRow: PublicThreadEventProcessRow = {
      ...row,
      tool_call_id: null,
      tool_input_json: null,
      tool_name: null,
      tool_status: null,
    };
    lastContentRow = projectedRow;
    let text = filter.push(fragment.text).text;
    if (outputOffset >= text.length) {
      outputOffset -= text.length;
      text = "";
    } else if (outputOffset > 0) {
      text = text.slice(outputOffset);
      outputOffset = 0;
    }
    if (text.length === 0) {
      continue;
    }
    if (pending !== null) {
      yield pending;
    }
    pending = { row: projectedRow, text };
  }

  if (input.cursor.finish) {
    let tail = filter.finish().text;
    if (outputOffset >= tail.length) {
      outputOffset -= tail.length;
      tail = "";
    } else if (outputOffset > 0) {
      tail = tail.slice(outputOffset);
      outputOffset = 0;
    }
    if (tail.length > 0) {
      if (pending === null) {
        if (lastContentRow === null) {
          throw new Error("Cannot finish a projected message without a content row.");
        }
        pending = { row: lastContentRow, text: tail };
      } else {
        pending = { ...pending, text: pending.text + tail };
      }
    }
  }

  if (pending !== null) {
    yield pending;
  }
}

async function reconcilePublicMessage(input: {
  database: D1Database;
  emit: (chunk: ProjectedMessageChunk) => void;
  request: PublicMessageReconciliationRequest;
  sessionId: SessionId;
}): Promise<PublicMessageReconciliationResult> {
  const suffix: string[] = [];
  const emitSuffix = () => {
    if (suffix.length === 0) {
      return false;
    }
    input.emit({ row: input.request.outputRow, text: suffix.join("") });
    return true;
  };
  const candidate = iterateProjectedMessageChunks({
    cursor: input.request.candidateCursor,
    database: input.database,
    row: input.request.sourceRow,
    sessionId: input.sessionId,
  })[Symbol.asyncIterator]();

  if (input.request.emittedCursor === null) {
    let chunk = await candidate.next();
    while (!chunk.done) {
      suffix.push(chunk.value.text);
      chunk = await candidate.next();
    }
    return { compatible: true, emitted: emitSuffix() };
  }

  const emitted = iterateProjectedMessageChunks({
    cursor: input.request.emittedCursor,
    database: input.database,
    row: input.request.sourceRow,
    sessionId: input.sessionId,
  })[Symbol.asyncIterator]();
  let candidateChunk = await candidate.next();
  let candidateOffset = 0;

  for (;;) {
    const emittedChunk = await emitted.next();
    if (emittedChunk.done) {
      break;
    }

    let emittedOffset = 0;
    while (emittedOffset < emittedChunk.value.text.length) {
      if (candidateChunk.done) {
        await emitted.return?.(undefined);
        return { compatible: false, emitted: false };
      }
      const comparedLength = Math.min(
        emittedChunk.value.text.length - emittedOffset,
        candidateChunk.value.text.length - candidateOffset,
      );
      if (
        emittedChunk.value.text.slice(emittedOffset, emittedOffset + comparedLength) !==
        candidateChunk.value.text.slice(candidateOffset, candidateOffset + comparedLength)
      ) {
        await candidate.return?.(undefined);
        await emitted.return?.(undefined);
        return { compatible: false, emitted: false };
      }
      emittedOffset += comparedLength;
      candidateOffset += comparedLength;
      if (candidateOffset === candidateChunk.value.text.length) {
        candidateChunk = await candidate.next();
        candidateOffset = 0;
      }
    }
  }

  if (!candidateChunk.done && candidateOffset < candidateChunk.value.text.length) {
    suffix.push(candidateChunk.value.text.slice(candidateOffset));
  }
  for (;;) {
    candidateChunk = await candidate.next();
    if (candidateChunk.done) {
      return { compatible: true, emitted: emitSuffix() };
    }
    suffix.push(candidateChunk.value.text);
  }
}

class PublicThreadEventWakeup {
  #pending = false;
  #socket: WebSocket | null;
  #waiter: (() => void) | null = null;

  constructor(socket: WebSocket | null) {
    this.#socket = socket;
    socket?.addEventListener("message", this.#handleMessage);
    socket?.addEventListener("close", this.#handleSocketUnavailable);
    socket?.addEventListener("error", this.#handleSocketUnavailable);
  }

  close(): void {
    const socket = this.#socket;

    this.#detachSocket();
    this.#waiter?.();

    if (socket !== null && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "public-event-stream.closed");
    }
  }

  wait(timeoutMs: number, signal: AbortSignal | null | undefined): Promise<void> {
    if (this.#pending) {
      this.#pending = false;
      return Promise.resolve();
    }

    if (signal?.aborted === true) {
      return Promise.resolve();
    }

    const wakeController = new AbortController();
    const wake = () => wakeController.abort();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    const notified = new Promise<void>((resolve) => {
      wakeController.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    let detachAbort = () => {};
    const aborted = new Promise<void>((resolve) => {
      const handleAbort = () => resolve();

      signal?.addEventListener("abort", handleAbort, { once: true });
      detachAbort = () => signal?.removeEventListener("abort", handleAbort);
    });

    this.#waiter = wake;

    return Promise.race([timeout, notified, aborted]).finally(() => {
      clearTimeout(timer);
      detachAbort();
      if (this.#waiter === wake) {
        this.#waiter = null;
      }
    });
  }

  readonly #handleMessage = () => {
    if (this.#waiter !== null) {
      this.#waiter();
      return;
    }

    this.#pending = true;
  };

  readonly #handleSocketUnavailable = () => {
    this.#detachSocket();
    this.#waiter?.();
  };

  #detachSocket(): void {
    const socket = this.#socket;

    if (socket === null) {
      return;
    }

    socket.removeEventListener("message", this.#handleMessage);
    socket.removeEventListener("close", this.#handleSocketUnavailable);
    socket.removeEventListener("error", this.#handleSocketUnavailable);
    this.#socket = null;
  }
}

async function connectPublicThreadEventWakeup(
  request: StreamPublicThreadEventsRequest,
  sessionId: SessionId,
): Promise<PublicThreadEventWakeup> {
  try {
    return new PublicThreadEventWakeup(
      await connectSessionPublicEventWebSocket(request.bindings, sessionId),
    );
  } catch (error) {
    logWarn("public_thread.event_wakeup.connect_failed", {
      ...createErrorLogContext(error),
      sessionId,
    });
    return new PublicThreadEventWakeup(null);
  }
}

function isPublicThreadEventLogType(value: string): value is PublicThreadEventLogType {
  return PUBLIC_THREAD_EVENT_LOG_TYPE_SET.has(value);
}

function normalizePublicThreadEventsLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLIC_THREAD_EVENTS_MAX_LIMIT) {
    throw publicInvalidRequest(`limit must be between 1 and ${PUBLIC_THREAD_EVENTS_MAX_LIMIT}.`);
  }

  return limit;
}

function toPublicThreadEventLogEntry(input: {
  event: SessionProcessEvent;
  row: PublicThreadEventProcessRow | undefined;
}): PublicThreadEventLogEntry | null {
  const { event } = input;

  if (!isPublicThreadEventLogType(event.type)) {
    return null;
  }

  let toolInput: JsonObject | undefined;

  if (input.row?.tool_input_json !== null && input.row?.tool_input_json !== undefined) {
    try {
      toolInput = parseJsonObject(JSON.parse(input.row.tool_input_json), "Persisted tool input");
    } catch {
      toolInput = undefined;
    }
  }

  return {
    content: sanitizePublicOutput(event.content).text,
    durationMs: event.durationMs,
    id: parsePlatformId(event.id, "Runtime event ID") as RuntimeEventId,
    occurredAt: event.occurredAt,
    runId: input.row?.run_id ?? null,
    status: event.status,
    ...(input.row?.tool_call_id === null || input.row?.tool_call_id === undefined
      ? {}
      : { toolCallId: input.row.tool_call_id }),
    ...(toolInput === undefined ? {} : { toolInput }),
    ...(input.row?.tool_name === null || input.row?.tool_name === undefined
      ? {}
      : { toolName: input.row.tool_name }),
    tokens: event.tokens,
    type: event.type,
  };
}

function toPublicThreadEventLogEntries(
  rows: PublicThreadEventProcessRow[],
): PublicThreadEventLogEntry[] {
  const rowsByEventId = new Map<RuntimeEventId, PublicThreadEventProcessRow>(
    rows.map((row) => [row.id, row]),
  );

  return createSessionProcessEventsFromSessionEventRows(rows).flatMap((event) => {
    const publicEvent = toPublicThreadEventLogEntry({
      event,
      row: rowsByEventId.get(event.id),
    });
    return publicEvent === null ? [] : [publicEvent];
  });
}

function toCanonicalPublicThreadEventLogEntries(
  rows: PublicThreadEventProcessRow[],
): PublicThreadEventLogEntry[] {
  return new PublicLiveEventRowProjector().seedFromCanonicalEvents(
    rows,
    toPublicThreadEventLogEntries(rows),
  );
}

function selectPublicThreadEventRows(input: {
  database: D1Database;
  filters: SQL[];
  order: SQL;
  pageSize: number;
}) {
  return getAppDatabase(input.database)
    .select({
      content_text: sessionEventsTable.contentText,
      ended_at: sessionEventsTable.endedAt,
      event_type: sessionEventsTable.eventType,
      id: sessionEventsTable.id,
      occurred_at: sessionEventsTable.occurredAt,
      process_status: sessionEventsTable.processStatus,
      process_type: sessionEventsTable.processType,
      run_id: sessionEventsTable.runId,
      seq: sessionEventsTable.seq,
      stream_id: sessionEventsTable.streamId,
      tool_call_id: sessionEventsTable.toolCallId,
      tool_input_json: sessionEventsTable.toolInputJson,
      tool_name: sessionEventsTable.toolName,
      tool_status: sessionEventsTable.toolStatus,
      tokens: sessionEventsTable.tokens,
    })
    .from(sessionEventsTable)
    .where(and(...input.filters))
    .orderBy(input.order)
    .limit(input.pageSize)
    .all();
}

async function readPublicThreadEventWindow(input: {
  database: D1Database;
  limit: number;
  sessionId: SessionId;
}): Promise<PublicThreadEventWindow> {
  const scannedRows: PublicThreadEventProcessRow[] = [];
  let beforeSeq: number | null = null;
  let reachedStart = false;
  let latestSeq: number | null = null;

  while (scannedRows.length < THREAD_EVENT_RAW_ROW_SCAN_LIMIT) {
    const remainingRows = THREAD_EVENT_RAW_ROW_SCAN_LIMIT - scannedRows.length;
    const rowCapacity = Math.min(THREAD_EVENT_ROW_PAGE_SIZE, remainingRows);
    const querySize = rowCapacity + 1;
    const filters = [
      eq(sessionEventsTable.sessionId, input.sessionId),
      eq(sessionEventsTable.visibility, "all_consumers"),
    ];

    if (beforeSeq !== null) {
      filters.push(lt(sessionEventsTable.seq, beforeSeq));
    }

    const page = await selectPublicThreadEventRows({
      database: input.database,
      filters,
      order: desc(sessionEventsTable.seq),
      pageSize: querySize,
    });

    if (page.length === 0) {
      reachedStart = true;
      break;
    }

    const scannedPage = page.slice(0, rowCapacity);
    latestSeq ??= scannedPage[0]?.seq ?? null;
    scannedRows.push(...scannedPage);
    beforeSeq = scannedPage[scannedPage.length - 1]?.seq ?? beforeSeq;
    const chronologicalRows = scannedRows.toReversed();
    const foldedRows = foldStreamedSessionEventRows(chronologicalRows);
    const events = toCanonicalPublicThreadEventLogEntries(chronologicalRows);

    if (events.length > input.limit) {
      const reachedDatabaseStart = page.length <= rowCapacity;
      const incompleteStreams = reachedDatabaseStart
        ? new Set<string>()
        : findLeftIncompleteSessionEventStreamKeys(chronologicalRows);
      const rowsByEventId = new Map(foldedRows.map((row) => [row.id, row]));
      const retainedStreamsAreComplete = events.slice(-input.limit).every((event) => {
        const row = rowsByEventId.get(event.id);
        const key = row === undefined ? null : getSessionEventStreamKey(row);
        return key === null || !incompleteStreams.has(key);
      });

      if (!retainedStreamsAreComplete) {
        continue;
      }

      return {
        events: events.slice(-input.limit),
        leftIncompleteStreamKeys: incompleteStreams,
        latestSeq,
        rows: chronologicalRows,
        trustUnknownMessageDeltas: reachedDatabaseStart,
        truncated: true,
      };
    }

    if (page.length <= rowCapacity) {
      reachedStart = true;
      break;
    }
  }

  const chronologicalRows = scannedRows.toReversed();
  const incompleteStreams = reachedStart
    ? new Set<string>()
    : findLeftIncompleteSessionEventStreamKeys(chronologicalRows);
  const completeRows = excludeSessionEventStreams(chronologicalRows, incompleteStreams);
  const events = toCanonicalPublicThreadEventLogEntries(completeRows);
  const truncated = !reachedStart || events.length > input.limit;

  return {
    events: truncated ? events.slice(-input.limit) : events,
    leftIncompleteStreamKeys: incompleteStreams,
    latestSeq,
    rows: chronologicalRows,
    trustUnknownMessageDeltas: reachedStart,
    truncated,
  };
}

async function readPublicThreadEventRowsAfterSeq(input: {
  afterSeq: number;
  database: D1Database;
  sessionId: SessionId;
}): Promise<PublicThreadEventProcessRow[]> {
  return selectPublicThreadEventRows({
    database: input.database,
    filters: [
      eq(sessionEventsTable.sessionId, input.sessionId),
      eq(sessionEventsTable.visibility, "all_consumers"),
      gt(sessionEventsTable.seq, input.afterSeq),
    ],
    order: asc(sessionEventsTable.seq),
    pageSize: THREAD_EVENT_ROW_PAGE_SIZE,
  });
}

export async function readPublicThreadRunFinalOutput(input: {
  database: D1Database;
  runId: SessionRunId;
  sessionId: SessionId;
}): Promise<PublicThreadFinalOutput | null> {
  const database = getAppDatabase(input.database);
  const snapshotRows = await database
    .select({
      eventType: sessionEventsTable.eventType,
      runStatus: sessionRunsTable.status,
      semanticHash: sessionEventsTable.semanticHash,
      seq: sessionEventsTable.seq,
      sourceEventId: sessionEventsTable.sourceEventId,
      streamId: sessionEventsTable.streamId,
      terminalEventJson: sessionEventsTable.terminalEventJson,
    })
    .from(sessionRunsTable)
    .leftJoin(
      sessionEventsTable,
      and(
        eq(sessionEventsTable.sessionId, sessionRunsTable.sessionId),
        eq(sessionEventsTable.runId, sessionRunsTable.id),
        inArray(sessionEventsTable.eventType, ["run.cancelled", "run.completed", "run.failed"]),
      ),
    )
    .where(
      and(eq(sessionRunsTable.id, input.runId), eq(sessionRunsTable.sessionId, input.sessionId)),
    )
    .limit(3)
    .all();
  const [snapshot] = snapshotRows;
  if (snapshot?.runStatus !== "completed") {
    return null;
  }
  const terminalRows = snapshotRows.flatMap((row) =>
    row.eventType === null
      ? []
      : [
          {
            eventType: row.eventType,
            semanticHash: row.semanticHash,
            seq: row.seq,
            sourceEventId: row.sourceEventId,
            streamId: row.streamId,
            terminalEventJson: row.terminalEventJson,
          },
        ],
  );
  if (terminalRows.length !== 1) {
    throw new Error(`Final assistant reference for run ${input.runId} is not immutable.`);
  }

  const terminal = terminalRows[0];
  if (terminal === undefined) {
    throw new Error(`Final assistant reference for run ${input.runId} is not immutable.`);
  }
  if (terminal.semanticHash !== null) {
    if (
      terminal.eventType !== "run.completed" ||
      terminal.seq === null ||
      terminal.sourceEventId !== createSessionRunTerminalSourceId(input.runId, "run.completed")
    ) {
      throw new Error(`Final assistant reference for run ${input.runId} is invalid.`);
    }
    const semanticAuthority = await readTerminalEventSemanticAuthority({
      eventJson: terminal.terminalEventJson,
      eventType: terminal.eventType,
      runId: input.runId,
      semanticHash: terminal.semanticHash,
      sessionId: input.sessionId,
      sourceEventId: terminal.sourceEventId,
      streamId: terminal.streamId,
    });
    if (semanticAuthority.finalMessageId === null) {
      return null;
    }
    const finalMessageId = parsePlatformId<SessionMessageId>(
      semanticAuthority.finalMessageId,
      "Final assistant message ID",
    );
    const message =
      (await database
        .select({
          content_text: sessionMessagesTable.contentText,
          id: sessionMessagesTable.id,
          plan_json: sessionMessagesTable.planJson,
          projection_format: sessionMessagesTable.projectionFormat,
          segments_json: sessionMessagesTable.segmentsJson,
        })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.id, finalMessageId),
            eq(sessionMessagesTable.sessionId, input.sessionId),
            eq(sessionMessagesTable.sessionRunId, input.runId),
            eq(sessionMessagesTable.role, "assistant"),
          ),
        )
        .limit(1)
        .get()) ?? null;
    if (
      message === null ||
      message.content_text !== "" ||
      message.plan_json !== null ||
      message.projection_format !== "event_stream_v3" ||
      message.segments_json !== null
    ) {
      throw new Error(`Final assistant reference ${finalMessageId} is not lightweight.`);
    }
    const sealed = await readSealedPublicSessionMessage(input.database, {
      endSeq: terminal.seq,
      processType: "agent.message.delta",
      runId: input.runId,
      sessionId: input.sessionId,
      streamId: finalMessageId,
    });
    if (sealed === null) {
      throw new Error(`Final assistant reference ${finalMessageId} is not sealed.`);
    }
    const sanitizedOutput = sanitizePublicOutput(sealed.text);
    return {
      text: sanitizedOutput.text,
      ...(sanitizedOutput.warnings.length === 0 ? {} : { warnings: sanitizedOutput.warnings }),
    };
  }

  if (
    terminal.eventType !== "run.completed" ||
    terminal.sourceEventId !== createSessionRunTerminalSourceId(input.runId, "run.completed")
  ) {
    throw new Error(`Legacy final assistant projection for run ${input.runId} is invalid.`);
  }

  const eventStreamReference = await database
    .select({ id: sessionMessagesTable.id })
    .from(sessionMessagesTable)
    .where(
      and(
        eq(sessionMessagesTable.sessionId, input.sessionId),
        eq(sessionMessagesTable.sessionRunId, input.runId),
        eq(sessionMessagesTable.role, "assistant"),
        eq(sessionMessagesTable.projectionFormat, "event_stream_v3"),
      ),
    )
    .limit(1)
    .get();
  if (eventStreamReference !== undefined) {
    throw new Error(`Final assistant reference for run ${input.runId} has no terminal pointer.`);
  }

  const message =
    (await database
      .select({
        content_text: sessionMessagesTable.contentText,
      })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, input.sessionId),
          eq(sessionMessagesTable.sessionRunId, input.runId),
          eq(sessionMessagesTable.role, "assistant"),
          eq(sessionMessagesTable.projectionFormat, "materialized"),
        ),
      )
      .orderBy(desc(sessionMessagesTable.seq))
      .limit(1)
      .get()) ?? null;

  if (message === null) {
    return null;
  }
  const sanitizedOutput = sanitizePublicOutput(message.content_text);

  return {
    text: sanitizedOutput.text,
    ...(sanitizedOutput.warnings.length === 0 ? {} : { warnings: sanitizedOutput.warnings }),
  };
}

async function resolvePublicThreadEventSessionId(
  request: ListPublicThreadEventsRequest,
): Promise<SessionId> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublicThreadReader(request.database, request.caller, snapshot);

  return toBackingSessionId(request.threadId);
}

export async function listPublicThreadEvents(
  request: ListPublicThreadEventsRequest,
): Promise<PublicThreadApiListThreadEventsResponse> {
  const limit = normalizePublicThreadEventsLimit(request.limit);
  const sessionId = await resolvePublicThreadEventSessionId(request);
  const window = await readPublicThreadEventWindow({
    database: request.database,
    limit,
    sessionId,
  });

  return {
    events: window.events,
    truncated: window.truncated,
  };
}

function encodeSseThreadEvent(event: PublicThreadEventLogEntry): string {
  return `event: thread.event\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function encodeSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

function enqueueSseText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  controller.enqueue(SSE_TEXT_ENCODER.encode(text));
}

function enqueueThreadEvents(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  events: PublicThreadEventLogEntry[];
}): boolean {
  for (const event of input.events) {
    enqueueSseText(input.controller, encodeSseThreadEvent(event));
  }

  return input.events.length > 0;
}

async function enqueueLiveThreadRows(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  database: D1Database;
  projector: PublicLiveEventRowProjector;
  rows: readonly PublicThreadEventProcessRow[];
  sessionId: SessionId;
}): Promise<boolean> {
  let enqueued = false;
  let pendingRows: PublicThreadEventProcessRow[] = [];
  const flushPendingRows = () => {
    if (pendingRows.length === 0) {
      return;
    }
    enqueued =
      enqueueThreadEvents({
        controller: input.controller,
        events: toPublicThreadEventLogEntries(pendingRows),
      }) || enqueued;
    pendingRows = [];
  };

  for (const row of input.rows) {
    const reconciled = new Map<string, PublicMessageReconciliationResult>();
    const requests = input.projector.getReconciliationRequests(row);
    if (requests.length > 0) {
      flushPendingRows();
    }
    for (const request of requests) {
      const result = await reconcilePublicMessage({
        database: input.database,
        emit: (chunk) => {
          enqueued =
            enqueueThreadEvents({
              controller: input.controller,
              events: toPublicThreadEventLogEntries([{ ...chunk.row, content_text: chunk.text }]),
            }) || enqueued;
        },
        request,
        sessionId: input.sessionId,
      });
      reconciled.set(request.key, result);
    }
    pendingRows.push(...input.projector.project([row], reconciled));
  }

  flushPendingRows();

  return enqueued;
}

function isStreamStopped(input: {
  signal: AbortSignal | null | undefined;
  state: { cancelled: boolean };
}): boolean {
  return input.state.cancelled || input.signal?.aborted === true;
}

function toSseErrorPayload(error: unknown) {
  const publicError = toPublicApiError(error) ?? publicInternalError();

  return {
    error: {
      code: publicError.code,
      message: publicError.message,
    },
  };
}

export async function createPublicThreadEventStream(
  request: StreamPublicThreadEventsRequest,
): Promise<ReadableStream<Uint8Array>> {
  const limit = normalizePublicThreadEventsLimit(request.limit);
  const sessionId = await resolvePublicThreadEventSessionId(request);
  const wakeup = await connectPublicThreadEventWakeup(request, sessionId);
  let initialWindow: PublicThreadEventWindow;

  try {
    initialWindow = await readPublicThreadEventWindow({
      database: request.database,
      limit,
      sessionId,
    });
  } catch (error) {
    wakeup.close();
    throw error;
  }
  const state = {
    cancelled: false,
  };
  let lastSeenSeq = initialWindow.latestSeq ?? 0;
  const liveProjector = new PublicLiveEventRowProjector();
  const initialEvents = liveProjector.seedFromCanonicalEvents(
    initialWindow.rows,
    initialWindow.events,
    initialWindow.leftIncompleteStreamKeys,
    initialWindow.trustUnknownMessageDeltas,
  );

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastHeartbeatAt = Date.now();

      try {
        enqueueSseText(controller, encodeSseComment("connected"));
        enqueueThreadEvents({
          controller,
          events: initialEvents,
        });

        while (!isStreamStopped({ signal: request.signal, state })) {
          await wakeup.wait(THREAD_EVENT_STREAM_POLL_INTERVAL_MS, request.signal);

          if (isStreamStopped({ signal: request.signal, state })) {
            break;
          }

          let enqueuedEvents = false;

          for (;;) {
            const rows = await readPublicThreadEventRowsAfterSeq({
              afterSeq: lastSeenSeq,
              database: request.database,
              sessionId,
            });

            if (rows.length === 0) {
              break;
            }

            lastSeenSeq = rows[rows.length - 1]?.seq ?? lastSeenSeq;
            enqueuedEvents =
              (await enqueueLiveThreadRows({
                controller,
                database: request.database,
                projector: liveProjector,
                rows,
                sessionId,
              })) || enqueuedEvents;

            if (rows.length < THREAD_EVENT_ROW_PAGE_SIZE) {
              break;
            }
          }

          const now = Date.now();

          if (enqueuedEvents) {
            lastHeartbeatAt = now;
            continue;
          }

          if (now - lastHeartbeatAt >= THREAD_EVENT_STREAM_HEARTBEAT_INTERVAL_MS) {
            enqueueSseText(controller, encodeSseComment("keepalive"));
            lastHeartbeatAt = now;
          }
        }
      } catch (error) {
        enqueueSseText(
          controller,
          `event: thread.error\ndata: ${JSON.stringify(toSseErrorPayload(error))}\n\n`,
        );
      } finally {
        wakeup.close();
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
      wakeup.close();
    },
  });
}
