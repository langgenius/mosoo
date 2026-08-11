import { OpenAiPrivateCitationStreamFilter } from "@mosoo/agent-driver/provider-output";
import type {
  PublicThreadApiListThreadEventsResponse,
  PublicThreadArtifact,
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
import { sessionEventsTable, sessionMessagesTable, sessionRunArtifactsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../platform/cloudflare/logger";
import { getAppDatabase } from "../../platform/db/drizzle";
import { toIsoString } from "../../time";
import { createSessionProcessEventsFromSessionEventRows } from "../sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../sessions/application/session-process-events.service";
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
  latestSeq: number | null;
  rows: PublicThreadEventProcessRow[];
  truncated: boolean;
}

interface PublicThreadEventProcessRow extends SessionEventProcessRow {
  artifact_created_at: number | null;
  artifact_file_id: FileId | null;
  artifact_mime_type: string | null;
  artifact_name: string | null;
  artifact_run_id: SessionRunId | null;
  artifact_size: number | null;
  run_id: SessionRunId | null;
  tool_call_id: string | null;
  tool_input_json: string | null;
  tool_name: string | null;
}

function toPublicThreadArtifact(
  row: Pick<
    PublicThreadEventProcessRow,
    | "artifact_created_at"
    | "artifact_file_id"
    | "artifact_mime_type"
    | "artifact_name"
    | "artifact_run_id"
    | "artifact_size"
  >,
): PublicThreadArtifact | null {
  if (
    row.artifact_created_at === null ||
    row.artifact_file_id === null ||
    row.artifact_name === null ||
    row.artifact_run_id === null ||
    row.artifact_size === null
  ) {
    return null;
  }

  return {
    createdAt: toIsoString(row.artifact_created_at),
    fileId: parsePlatformId<FileId>(row.artifact_file_id, "Artifact file ID"),
    kind: "artifact",
    mimeType: row.artifact_mime_type,
    name: row.artifact_name,
    runId: parsePlatformId<SessionRunId>(row.artifact_run_id, "Artifact Run ID"),
    size: row.artifact_size,
  };
}

interface LiveMessageState {
  filter: OpenAiPrivateCitationStreamFilter;
  text: string;
}

class PublicLiveEventRowProjector {
  readonly #messages = new Map<string, LiveMessageState>();
  readonly #messageKeysByRun = new Map<string, Set<string>>();

  #getMessageRunKey(row: PublicThreadEventProcessRow): string {
    return row.run_id ?? "";
  }

  #getMessageKey(row: PublicThreadEventProcessRow): string {
    return `${this.#getMessageRunKey(row)}:${row.process_type}`;
  }

  #setMessage(row: PublicThreadEventProcessRow, message: LiveMessageState): void {
    const key = this.#getMessageKey(row);
    const runKey = this.#getMessageRunKey(row);
    const runKeys = this.#messageKeysByRun.get(runKey);

    this.#messages.set(key, message);
    if (runKeys === undefined) {
      this.#messageKeysByRun.set(runKey, new Set([key]));
    } else {
      runKeys.add(key);
    }
  }

  #deleteMessage(row: PublicThreadEventProcessRow): void {
    const key = this.#getMessageKey(row);
    const runKey = this.#getMessageRunKey(row);
    const runKeys = this.#messageKeysByRun.get(runKey);

    this.#messages.delete(key);
    runKeys?.delete(key);
    if (runKeys?.size === 0) {
      this.#messageKeysByRun.delete(runKey);
    }
  }

  #deleteRunMessages(runId: SessionRunId | null): void {
    const runKey = runId ?? "";
    const messageKeys = this.#messageKeysByRun.get(runKey);

    if (messageKeys === undefined) {
      return;
    }

    for (const messageKey of messageKeys) {
      this.#messages.delete(messageKey);
    }

    this.#messageKeysByRun.delete(runKey);
  }

  project(rows: readonly PublicThreadEventProcessRow[]): PublicThreadEventProcessRow[] {
    const output: PublicThreadEventProcessRow[] = [];

    for (const row of rows) {
      const key = this.#getMessageKey(row);

      if (row.event_type === "message.started") {
        this.#setMessage(row, {
          filter: new OpenAiPrivateCitationStreamFilter(),
          text: "",
        });
        continue;
      }

      if (row.event_type === "message.delta") {
        let message = this.#messages.get(key);

        if (message === undefined) {
          message = { filter: new OpenAiPrivateCitationStreamFilter(), text: "" };
          this.#setMessage(row, message);
        }

        const contentText = message.filter.push(row.content_text).text;
        message.text += contentText;

        if (contentText.length > 0) {
          output.push({ ...row, content_text: contentText });
        }
        continue;
      }

      if (row.event_type === "message.completed") {
        const message = this.#messages.get(key);
        const contentText = message?.filter.finish().text ?? "";

        if (message !== undefined) {
          message.text += contentText;
        }
        if (contentText.length > 0) {
          output.push({ ...row, content_text: contentText });
        }
        continue;
      }

      if (row.event_type === "message.added") {
        const message = this.#messages.get(key);
        this.#deleteMessage(row);

        if (message !== undefined) {
          const snapshotText = sanitizePublicOutput(row.content_text).text;

          // SSE is append-only; a divergent snapshot stays canonical through
          // run.finalOutput because emitted text cannot be retracted.
          if (snapshotText.startsWith(message.text)) {
            const suffix = snapshotText.slice(message.text.length);

            if (suffix.length > 0) {
              output.push({ ...row, content_text: suffix });
            }
          }
          continue;
        }
      }

      if (row.event_type === "thought.started" || row.event_type === "thought.completed") {
        continue;
      }

      if (
        row.event_type === "run.cancelled" ||
        row.event_type === "run.completed" ||
        row.event_type === "run.failed"
      ) {
        this.#deleteRunMessages(row.run_id);
      }

      output.push(row);
    }

    return output;
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
  artifact: PublicThreadArtifact | null;
  event: SessionProcessEvent;
  row: PublicThreadEventProcessRow | undefined;
}): PublicThreadEventLogEntry | null {
  const { event } = input;

  if (!isPublicThreadEventLogType(event.type)) {
    return null;
  }

  let toolInput: JsonObject | undefined;

  if (input.row?.tool_input_json !== null && input.row?.tool_input_json !== undefined) {
    toolInput = parseJsonObject(JSON.parse(input.row.tool_input_json), "Persisted tool input");
  }

  return {
    ...(input.artifact === null ? {} : { artifact: input.artifact }),
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
  options: { foldStreamedRows?: boolean } = {},
): PublicThreadEventLogEntry[] {
  const rowsByEventId = new Map<RuntimeEventId, PublicThreadEventProcessRow>(
    rows.map((row) => [row.id, row]),
  );
  const artifactsByEventId = new Map<RuntimeEventId, PublicThreadArtifact>(
    rows.flatMap((row) => {
      const artifact = toPublicThreadArtifact(row);
      return artifact === null ? [] : [[row.id, artifact]];
    }),
  );

  return createSessionProcessEventsFromSessionEventRows(rows, options).flatMap((event) => {
    const publicEvent = toPublicThreadEventLogEntry({
      artifact: artifactsByEventId.get(event.id) ?? null,
      event,
      row: rowsByEventId.get(event.id),
    });
    return publicEvent === null ? [] : [publicEvent];
  });
}

function selectPublicThreadEventRows(input: {
  database: D1Database;
  filters: SQL[];
  order: SQL;
  pageSize: number;
}) {
  return getAppDatabase(input.database)
    .select({
      artifact_created_at: sessionRunArtifactsTable.createdAt,
      artifact_file_id: sessionRunArtifactsTable.fileId,
      artifact_mime_type: sessionRunArtifactsTable.mimeType,
      artifact_name: sessionRunArtifactsTable.name,
      artifact_run_id: sessionRunArtifactsTable.sessionRunId,
      artifact_size: sessionRunArtifactsTable.size,
      content_text: sessionEventsTable.contentText,
      ended_at: sessionEventsTable.endedAt,
      event_type: sessionEventsTable.eventType,
      id: sessionEventsTable.id,
      occurred_at: sessionEventsTable.occurredAt,
      process_status: sessionEventsTable.processStatus,
      process_type: sessionEventsTable.processType,
      run_id: sessionEventsTable.runId,
      seq: sessionEventsTable.seq,
      tool_call_id: sessionEventsTable.toolCallId,
      tool_input_json: sessionEventsTable.toolInputJson,
      tool_name: sessionEventsTable.toolName,
      tokens: sessionEventsTable.tokens,
    })
    .from(sessionEventsTable)
    .leftJoin(
      sessionRunArtifactsTable,
      eq(sessionRunArtifactsTable.committedEventId, sessionEventsTable.sourceEventId),
    )
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
    const pageSize = Math.min(THREAD_EVENT_ROW_PAGE_SIZE, remainingRows);
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
      pageSize,
    });

    if (page.length === 0) {
      reachedStart = true;
      break;
    }

    latestSeq ??= page[0]?.seq ?? null;
    scannedRows.push(...page);
    beforeSeq = page[page.length - 1]?.seq ?? beforeSeq;

    const events = toPublicThreadEventLogEntries(scannedRows.toReversed());

    if (events.length > input.limit) {
      return {
        events: events.slice(-input.limit),
        latestSeq,
        rows: scannedRows.toReversed(),
        truncated: true,
      };
    }

    if (page.length < pageSize) {
      reachedStart = true;
      break;
    }
  }

  const events = toPublicThreadEventLogEntries(scannedRows.toReversed());
  const truncated = !reachedStart || events.length > input.limit;

  return {
    events: truncated ? events.slice(-input.limit) : events,
    latestSeq,
    rows: scannedRows.toReversed(),
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
  const message =
    (await getAppDatabase(input.database)
      .select({
        content: sessionMessagesTable.contentText,
      })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, input.sessionId),
          eq(sessionMessagesTable.sessionRunId, input.runId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .orderBy(desc(sessionMessagesTable.seq))
      .limit(1)
      .get()) ?? null;

  if (message === null) {
    return null;
  }

  const sanitizedOutput = sanitizePublicOutput(message.content);

  return {
    text: sanitizedOutput.text,
    ...(sanitizedOutput.warnings.length === 0 ? {} : { warnings: sanitizedOutput.warnings }),
  };
}

export async function readPublicThreadRunArtifacts(input: {
  database: D1Database;
  runId: SessionRunId;
}): Promise<PublicThreadArtifact[]> {
  const rows = await getAppDatabase(input.database)
    .select({
      artifact_created_at: sessionRunArtifactsTable.createdAt,
      artifact_file_id: sessionRunArtifactsTable.fileId,
      artifact_mime_type: sessionRunArtifactsTable.mimeType,
      artifact_name: sessionRunArtifactsTable.name,
      artifact_run_id: sessionRunArtifactsTable.sessionRunId,
      artifact_size: sessionRunArtifactsTable.size,
    })
    .from(sessionRunArtifactsTable)
    .where(eq(sessionRunArtifactsTable.sessionRunId, input.runId))
    .orderBy(asc(sessionRunArtifactsTable.createdAt), asc(sessionRunArtifactsTable.fileId))
    .all();

  return rows.flatMap((row) => {
    const artifact = toPublicThreadArtifact(row);
    return artifact === null ? [] : [artifact];
  });
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
  emittedEventIds: Set<RuntimeEventId>;
  events: PublicThreadEventLogEntry[];
}): boolean {
  let enqueued = false;

  for (const event of input.events) {
    if (input.emittedEventIds.has(event.id)) {
      continue;
    }

    input.emittedEventIds.add(event.id);
    enqueueSseText(input.controller, encodeSseThreadEvent(event));
    enqueued = true;
  }

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
  const emittedEventIds = new Set<RuntimeEventId>();
  const state = {
    cancelled: false,
  };
  let lastSeenSeq = initialWindow.latestSeq ?? 0;
  const liveProjector = new PublicLiveEventRowProjector();
  const initialEvents = toPublicThreadEventLogEntries(
    liveProjector.project(initialWindow.rows),
  ).slice(-limit);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastHeartbeatAt = Date.now();

      try {
        enqueueSseText(controller, encodeSseComment("connected"));
        enqueueThreadEvents({
          controller,
          emittedEventIds,
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
              enqueueThreadEvents({
                controller,
                emittedEventIds,
                events: toPublicThreadEventLogEntries(liveProjector.project(rows)),
              }) || enqueuedEvents;

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
