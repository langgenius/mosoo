import type {
  PublishedAgentListThreadEventsResponse,
  PublishedThreadEventLogEntry,
  PublishedThreadEventLogType,
} from "@mosoo/contracts/public-api";
import {
  PUBLISHED_THREAD_EVENT_LOG_TYPES,
  PUBLISHED_THREAD_EVENTS_MAX_LIMIT,
} from "@mosoo/contracts/public-api";
import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { createSessionProcessEventsFromSessionEventRows } from "../sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../sessions/application/session-process-events.service";
import {
  publicInternalError,
  publicInvalidRequest,
  toPublishedAgentApiError,
} from "./published-agent-api-errors";
import { admitPublishedThreadReader } from "./published-agent-thread-admission";
import { toBackingSessionId } from "./published-agent-thread-ids";
import { getThreadSnapshot } from "./published-agent-thread-store";
import type {
  ListPublishedAgentThreadEventsRequest,
  StreamPublishedAgentThreadEventsRequest,
} from "./published-agent-thread.types";

const THREAD_EVENT_ROW_PAGE_SIZE = PUBLISHED_THREAD_EVENTS_MAX_LIMIT;
const THREAD_EVENT_RAW_ROW_SCAN_LIMIT = PUBLISHED_THREAD_EVENTS_MAX_LIMIT * 20;
const THREAD_EVENT_STREAM_POLL_INTERVAL_MS = 2_000;
const THREAD_EVENT_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;
const PUBLISHED_THREAD_EVENT_LOG_TYPE_SET: ReadonlySet<string> = new Set(
  PUBLISHED_THREAD_EVENT_LOG_TYPES,
);
const SSE_TEXT_ENCODER = new TextEncoder();

interface PublishedThreadEventWindow {
  events: PublishedThreadEventLogEntry[];
  latestSeq: number | null;
  truncated: boolean;
}

function isPublishedThreadEventLogType(value: string): value is PublishedThreadEventLogType {
  return PUBLISHED_THREAD_EVENT_LOG_TYPE_SET.has(value);
}

function normalizePublishedThreadEventsLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLISHED_THREAD_EVENTS_MAX_LIMIT) {
    throw publicInvalidRequest(`limit must be between 1 and ${PUBLISHED_THREAD_EVENTS_MAX_LIMIT}.`);
  }

  return limit;
}

function toPublishedThreadEventLogEntry(
  event: SessionProcessEvent,
): PublishedThreadEventLogEntry | null {
  if (!isPublishedThreadEventLogType(event.type)) {
    return null;
  }

  return {
    content: event.content,
    durationMs: event.durationMs,
    id: parsePlatformId(event.id, "Runtime event ID") as RuntimeEventId,
    occurredAt: event.occurredAt,
    status: event.status,
    tokens: event.tokens,
    type: event.type,
  };
}

function toPublishedThreadEventLogEntries(
  rows: SessionEventProcessRow[],
): PublishedThreadEventLogEntry[] {
  return createSessionProcessEventsFromSessionEventRows(rows).flatMap((event) => {
    const publishedEvent = toPublishedThreadEventLogEntry(event);
    return publishedEvent === null ? [] : [publishedEvent];
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
      id: sessionEventsTable.id,
      occurred_at: sessionEventsTable.occurredAt,
      process_status: sessionEventsTable.processStatus,
      process_type: sessionEventsTable.processType,
      seq: sessionEventsTable.seq,
      tokens: sessionEventsTable.tokens,
    })
    .from(sessionEventsTable)
    .where(and(...input.filters))
    .orderBy(input.order)
    .limit(input.pageSize)
    .all();
}

async function readPublishedThreadEventWindow(input: {
  database: D1Database;
  limit: number;
  sessionId: SessionId;
}): Promise<PublishedThreadEventWindow> {
  const scannedRows: SessionEventProcessRow[] = [];
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

    const events = toPublishedThreadEventLogEntries(scannedRows.toReversed());

    if (events.length > input.limit) {
      return {
        events: events.slice(-input.limit),
        latestSeq,
        truncated: true,
      };
    }

    if (page.length < pageSize) {
      reachedStart = true;
      break;
    }
  }

  const events = toPublishedThreadEventLogEntries(scannedRows.toReversed());
  const truncated = !reachedStart || events.length > input.limit;

  return {
    events: truncated ? events.slice(-input.limit) : events,
    latestSeq,
    truncated,
  };
}

async function readPublishedThreadEventRowsAfterSeq(input: {
  afterSeq: number;
  database: D1Database;
  sessionId: SessionId;
}): Promise<SessionEventProcessRow[]> {
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

async function resolvePublishedThreadEventSessionId(
  request: ListPublishedAgentThreadEventsRequest,
): Promise<SessionId> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublishedThreadReader(request.database, request.caller, snapshot);

  return toBackingSessionId(request.threadId);
}

export async function listPublishedAgentThreadEvents(
  request: ListPublishedAgentThreadEventsRequest,
): Promise<PublishedAgentListThreadEventsResponse> {
  const limit = normalizePublishedThreadEventsLimit(request.limit);
  const sessionId = await resolvePublishedThreadEventSessionId(request);
  const window = await readPublishedThreadEventWindow({
    database: request.database,
    limit,
    sessionId,
  });

  return {
    events: window.events,
    truncated: window.truncated,
  };
}

function encodeSseThreadEvent(event: PublishedThreadEventLogEntry): string {
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
  events: PublishedThreadEventLogEntry[];
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
  const publicError = toPublishedAgentApiError(error) ?? publicInternalError();

  return {
    error: {
      code: publicError.code,
      message: publicError.message,
    },
  };
}

export async function createPublishedAgentThreadEventStream(
  request: StreamPublishedAgentThreadEventsRequest,
): Promise<ReadableStream<Uint8Array>> {
  const limit = normalizePublishedThreadEventsLimit(request.limit);
  const sessionId = await resolvePublishedThreadEventSessionId(request);
  const initialWindow = await readPublishedThreadEventWindow({
    database: request.database,
    limit,
    sessionId,
  });
  const emittedEventIds = new Set<RuntimeEventId>();
  const state = {
    cancelled: false,
  };
  let lastSeenSeq = initialWindow.latestSeq ?? 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastHeartbeatAt = Date.now();

      try {
        enqueueSseText(controller, encodeSseComment("connected"));
        enqueueThreadEvents({
          controller,
          emittedEventIds,
          events: initialWindow.events,
        });

        while (!isStreamStopped({ signal: request.signal, state })) {
          await delay(THREAD_EVENT_STREAM_POLL_INTERVAL_MS);

          if (isStreamStopped({ signal: request.signal, state })) {
            break;
          }

          let enqueuedEvents = false;

          for (;;) {
            const rows = await readPublishedThreadEventRowsAfterSeq({
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
                events: toPublishedThreadEventLogEntries(rows),
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
