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
import { sessionEventsTable, sessionMessagesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { createSessionProcessEventsFromSessionEventRows } from "../sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../sessions/application/session-process-events.service";
import { foldStreamedSessionEventRows } from "../sessions/domain/session-event-stream-fold";
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
  run_id: SessionRunId | null;
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
  runId: SessionRunId | null;
}): PublicThreadEventLogEntry | null {
  const { event } = input;

  if (!isPublicThreadEventLogType(event.type)) {
    return null;
  }

  return {
    content: sanitizePublicOutput(event.content).text,
    durationMs: event.durationMs,
    id: parsePlatformId(event.id, "Runtime event ID") as RuntimeEventId,
    occurredAt: event.occurredAt,
    runId: input.runId,
    status: event.status,
    tokens: event.tokens,
    type: event.type,
  };
}

function toPublicThreadEventLogEntries(
  rows: PublicThreadEventProcessRow[],
  options: { foldStreamedRows?: boolean } = {},
): PublicThreadEventLogEntry[] {
  const runIdsByEventId = new Map<RuntimeEventId, SessionRunId | null>(
    rows.map((row) => [row.id, row.run_id]),
  );

  return createSessionProcessEventsFromSessionEventRows(rows, options).flatMap((event) => {
    const publicEvent = toPublicThreadEventLogEntry({
      event,
      runId: runIdsByEventId.get(event.id) ?? null,
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
      content_text: sessionEventsTable.contentText,
      ended_at: sessionEventsTable.endedAt,
      event_type: sessionEventsTable.eventType,
      id: sessionEventsTable.id,
      occurred_at: sessionEventsTable.occurredAt,
      process_status: sessionEventsTable.processStatus,
      process_type: sessionEventsTable.processType,
      run_id: sessionEventsTable.runId,
      seq: sessionEventsTable.seq,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const initialWindow = await readPublicThreadEventWindow({
    database: request.database,
    limit,
    sessionId,
  });
  const emittedEventIds = new Set<RuntimeEventId>();
  const state = {
    cancelled: false,
  };
  let lastSeenSeq = initialWindow.latestSeq ?? 0;
  // Streamed text fragments are persisted one row each; hold a stream's rows
  // back until its closing row lands so every message is emitted exactly once
  // as a complete entry instead of one entry per fragment.
  const initialFold = foldStreamedSessionEventRows(initialWindow.rows, {
    flushOpenStreams: false,
  });
  let pendingStreamRows = initialFold.openStreamRows;
  const initialEvents = toPublicThreadEventLogEntries(initialFold.rows, {
    foldStreamedRows: false,
  }).slice(-limit);

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
          await delay(THREAD_EVENT_STREAM_POLL_INTERVAL_MS);

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
            const fold = foldStreamedSessionEventRows([...pendingStreamRows, ...rows], {
              flushOpenStreams: false,
            });
            pendingStreamRows = fold.openStreamRows;
            enqueuedEvents =
              enqueueThreadEvents({
                controller,
                emittedEventIds,
                events: toPublicThreadEventLogEntries(fold.rows, { foldStreamedRows: false }),
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
        controller.close();
      }
    },
    cancel() {
      state.cancelled = true;
    },
  });
}
