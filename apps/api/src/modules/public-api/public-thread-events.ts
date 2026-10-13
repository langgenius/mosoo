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
import { sessionMessagesTable } from "@mosoo/db";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../platform/cloudflare/logger";
import { getAppDatabase } from "../../platform/db/drizzle";
import { toIsoString } from "../../time";
import { createSessionProcessEventsFromFoldedRows } from "../sessions/application/session-process-events.service";
import { readStoredThoughtEvent } from "../sessions/domain/session-event-stream-fold";
import {
  readFoldedSessionEventRows,
  readSessionEventRowsAfterSeq,
  readSessionEventWindow,
} from "../sessions/infrastructure/session-event-read.repository";
import type {
  SessionEventProcessRow,
  SessionEventReadWindow,
} from "../sessions/infrastructure/session-event-read.repository";
import { connectSessionPublicEventWebSocket } from "../sessions/infrastructure/session/client";
import { publicInternalError, toPublicApiError } from "./public-api-errors";
import { sanitizePublicOutput } from "./public-output-sanitization";
import { admitPublicThread } from "./public-thread-session-query.service";
import type {
  ListPublicThreadEventsRequest,
  StreamPublicThreadEventsRequest,
} from "./public-thread.types";

const THREAD_EVENT_RAW_ROW_SCAN_LIMIT = PUBLIC_THREAD_EVENTS_MAX_LIMIT * 20;
const THREAD_EVENT_STREAM_POLL_INTERVAL_MS = 2_000;
const THREAD_EVENT_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;
const PUBLIC_THREAD_EVENT_LOG_TYPE_SET: ReadonlySet<string> = new Set(
  PUBLIC_THREAD_EVENT_LOG_TYPES,
);
const SSE_TEXT_ENCODER = new TextEncoder();

interface PublicThreadEventWindow extends SessionEventReadWindow {
  events: PublicThreadEventLogEntry[];
}

type PublicThreadEventProcessRow = SessionEventProcessRow;

interface LiveMessageState {
  filter: OpenAiPrivateCitationStreamFilter;
  text: string;
}

class PublicLiveEventRowProjector {
  readonly #messages = new Map<string, LiveMessageState>();
  readonly #messageKeysByRun = new Map<string, Set<string>>();
  readonly #thoughts = new Map<
    string,
    { filter: OpenAiPrivateCitationStreamFilter; nextOffset: number; runId: SessionRunId | null }
  >();

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
    for (const [key, thought] of this.#thoughts) {
      if (thought.runId === runId) this.#thoughts.delete(key);
    }
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
      if (row.event_type.startsWith("thought.")) {
        if (
          row.event_type === "thought.started" ||
          row.event_type === "thought.delta" ||
          row.thought_id === null
        ) {
          continue;
        }
        const storedThought = readStoredThoughtEvent(row);
        if (storedThought === null) continue;
        const thoughtKey = JSON.stringify([row.run_id, storedThought.thoughtId]);
        if (storedThought.offset !== null) {
          let thought = this.#thoughts.get(thoughtKey);
          if (thought === undefined) {
            if (storedThought.offset !== 0) continue;
            thought = {
              filter: new OpenAiPrivateCitationStreamFilter(),
              nextOffset: 0,
              runId: row.run_id,
            };
            this.#thoughts.set(thoughtKey, thought);
          }
          if (storedThought.offset !== thought.nextOffset) {
            throw new Error("Persisted thought content chunks are not contiguous.");
          }
          thought.nextOffset += storedThought.content.length;
          output.push({ ...row, content_text: thought.filter.push(storedThought.content).text });
        } else {
          const contentText = this.#thoughts.get(thoughtKey)?.filter.finish().text ?? "";
          this.#thoughts.delete(thoughtKey);
          if (contentText.length > 0) output.push({ ...row, content_text: contentText });
        }
        continue;
      }

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

      if (
        row.event_type === "message.completed" ||
        row.event_type === "message.cancelled" ||
        row.event_type === "message.failed"
      ) {
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
    toolInput = parseJsonObject(JSON.parse(input.row.tool_input_json), "Persisted tool input");
  }

  return {
    content: sanitizePublicOutput(event.content).text,
    durationMs: event.durationMs,
    id: event.id,
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

  return createSessionProcessEventsFromFoldedRows(rows).flatMap((event) => {
    const publicEvent = toPublicThreadEventLogEntry({
      event,
      row: rowsByEventId.get(event.id),
    });
    return publicEvent === null ? [] : [publicEvent];
  });
}

function toPublicThreadStreamEventLogEntries(
  rows: PublicThreadEventProcessRow[],
): PublicThreadEventLogEntry[] {
  return rows.flatMap((row) => {
    const event = toPublicThreadEventLogEntry({
      event: {
        content: row.content_text,
        durationMs: Math.max(0, row.ended_at - row.occurred_at),
        id: row.id,
        occurredAt: toIsoString(row.occurred_at),
        status: row.process_status,
        tokens: row.tokens,
        type: row.process_type,
      },
      row,
    });
    return event === null ? [] : [event];
  });
}

async function readPublicThreadEventWindow(input: {
  database: D1Database;
  limit: number;
  sessionId: SessionId;
}): Promise<PublicThreadEventWindow> {
  let rowLimit = PUBLIC_THREAD_EVENTS_MAX_LIMIT;
  for (;;) {
    const window = await readSessionEventWindow(input.database, {
      rowLimit,
      sessionId: input.sessionId,
    });
    const rows = await readFoldedSessionEventRows(input.database, {
      sessionId: input.sessionId,
      window,
    });
    const events = toPublicThreadEventLogEntries(rows);
    if (
      events.length > input.limit ||
      !window.truncated ||
      window.rowCount < rowLimit ||
      rowLimit === THREAD_EVENT_RAW_ROW_SCAN_LIMIT
    ) {
      return {
        ...window,
        events: events.slice(-input.limit),
        truncated: window.truncated || events.length > input.limit,
      };
    }
    rowLimit = Math.min(rowLimit * 2, THREAD_EVENT_RAW_ROW_SCAN_LIMIT);
  }
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

export async function listPublicThreadEvents(
  request: ListPublicThreadEventsRequest,
): Promise<PublicThreadApiListThreadEventsResponse> {
  await admitPublicThread(request.database, request.caller, request.threadId, request.apiVersion);
  const window = await readPublicThreadEventWindow({
    database: request.database,
    limit: request.limit,
    sessionId: request.threadId,
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
  const { limit, threadId: sessionId } = request;
  await admitPublicThread(request.database, request.caller, sessionId, request.apiVersion);
  const wakeup = await connectPublicThreadEventWakeup(request, sessionId);
  let initialWindow: SessionEventReadWindow;

  try {
    initialWindow = await readSessionEventWindow(request.database, {
      rowLimit: PUBLIC_THREAD_EVENTS_MAX_LIMIT,
      sessionId,
    });
  } catch (error) {
    wakeup.close();
    throw error;
  }
  const state = { cancelled: false, closed: false };
  let lastSeenSeq = initialWindow.latestSeq ?? 0;
  let lastHeartbeatAt = Date.now();
  let liveProjector = new PublicLiveEventRowProjector();
  let initialReplayPending = true;
  let pendingEvents: PublicThreadEventLogEntry[] = [];
  let detachAbort = () => {};

  const closeWakeup = () => {
    detachAbort();
    wakeup.close();
  };
  const stopped = () => state.closed || isStreamStopped({ signal: request.signal, state });

  async function readInitialEvents(): Promise<PublicThreadEventLogEntry[]> {
    let rowLimit = PUBLIC_THREAD_EVENTS_MAX_LIMIT;
    for (;;) {
      liveProjector = new PublicLiveEventRowProjector();
      const events: PublicThreadEventLogEntry[] = [];
      let afterSeq = (initialWindow.oldestSeq ?? 1) - 1;
      while (
        !stopped() &&
        initialWindow.oldestSeq !== null &&
        initialWindow.latestSeq !== null &&
        afterSeq < initialWindow.latestSeq
      ) {
        const rows = await readSessionEventRowsAfterSeq(request.database, {
          afterSeq,
          sessionId,
          throughSeq: initialWindow.latestSeq,
        });
        if (rows.length === 0) break;
        events.push(...toPublicThreadStreamEventLogEntries(liveProjector.project(rows)));
        if (events.length > limit) events.splice(0, events.length - limit);
        afterSeq = rows.at(-1)!.seq;
      }
      if (
        stopped() ||
        events.length >= limit ||
        !initialWindow.truncated ||
        initialWindow.rowCount < rowLimit ||
        rowLimit === THREAD_EVENT_RAW_ROW_SCAN_LIMIT
      ) {
        lastSeenSeq = initialWindow.latestSeq ?? 0;
        return events.toReversed();
      }
      rowLimit = Math.min(rowLimit * 2, THREAD_EVENT_RAW_ROW_SCAN_LIMIT);
      initialWindow = await readSessionEventWindow(request.database, {
        rowLimit,
        sessionId,
      });
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        if (state.closed) return;
        state.closed = true;
        closeWakeup();
        controller.close();
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => request.signal?.removeEventListener("abort", onAbort);
      if (request.signal?.aborted === true) {
        onAbort();
      } else {
        enqueueSseText(controller, encodeSseComment("connected"));
      }
    },
    async pull(controller) {
      try {
        if (initialReplayPending) {
          pendingEvents = await readInitialEvents();
          initialReplayPending = false;
        }
        while (!stopped()) {
          const event = pendingEvents.pop();
          if (event !== undefined) {
            enqueueSseText(controller, encodeSseThreadEvent(event));
            lastHeartbeatAt = Date.now();
            return;
          }

          const rows = await readSessionEventRowsAfterSeq(request.database, {
            afterSeq: lastSeenSeq,
            sessionId,
          });
          if (stopped()) return;
          if (rows.length > 0) {
            lastSeenSeq = rows.at(-1)!.seq;
            pendingEvents = toPublicThreadStreamEventLogEntries(
              liveProjector.project(rows),
            ).toReversed();
            continue;
          }

          if (Date.now() - lastHeartbeatAt >= THREAD_EVENT_STREAM_HEARTBEAT_INTERVAL_MS) {
            enqueueSseText(controller, encodeSseComment("keepalive"));
            lastHeartbeatAt = Date.now();
            return;
          }
          await wakeup.wait(THREAD_EVENT_STREAM_POLL_INTERVAL_MS, request.signal);
        }
      } catch (error) {
        if (!stopped()) {
          enqueueSseText(
            controller,
            `event: thread.error\ndata: ${JSON.stringify(toSseErrorPayload(error))}\n\n`,
          );
          state.closed = true;
          closeWakeup();
          controller.close();
        }
      }
    },
    cancel() {
      state.cancelled = true;
      state.closed = true;
      pendingEvents = [];
      closeWakeup();
    },
  });
}
