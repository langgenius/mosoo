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
import { and, desc, eq, lt } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { createSessionProcessEventsFromSessionEventRows } from "../sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../sessions/application/session-process-events.service";
import { publicInvalidRequest } from "./published-agent-api-errors";
import { admitPublishedThreadReader } from "./published-agent-thread-admission";
import { toBackingSessionId } from "./published-agent-thread-ids";
import { getThreadSnapshot } from "./published-agent-thread-store";
import type { ListPublishedAgentThreadEventsRequest } from "./published-agent-thread.types";

const THREAD_EVENT_ROW_PAGE_SIZE = PUBLISHED_THREAD_EVENTS_MAX_LIMIT;
const THREAD_EVENT_RAW_ROW_SCAN_LIMIT = PUBLISHED_THREAD_EVENTS_MAX_LIMIT * 20;
const PUBLISHED_THREAD_EVENT_LOG_TYPE_SET: ReadonlySet<string> = new Set(
  PUBLISHED_THREAD_EVENT_LOG_TYPES,
);

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

async function readPublishedThreadEventWindow(input: {
  database: D1Database;
  limit: number;
  sessionId: SessionId;
}): Promise<PublishedAgentListThreadEventsResponse> {
  const scannedRows: SessionEventProcessRow[] = [];
  let beforeSeq: number | null = null;
  let reachedStart = false;

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

    const page = await getAppDatabase(input.database)
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
      .where(and(...filters))
      .orderBy(desc(sessionEventsTable.seq))
      .limit(pageSize)
      .all();

    if (page.length === 0) {
      reachedStart = true;
      break;
    }

    scannedRows.push(...page);
    beforeSeq = page[page.length - 1]?.seq ?? beforeSeq;

    const events = toPublishedThreadEventLogEntries(scannedRows.toReversed());

    if (events.length > input.limit) {
      return {
        events: events.slice(-input.limit),
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
    truncated,
  };
}

export async function listPublishedAgentThreadEvents(
  request: ListPublishedAgentThreadEventsRequest,
): Promise<PublishedAgentListThreadEventsResponse> {
  const limit = normalizePublishedThreadEventsLimit(request.limit);
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublishedThreadReader(request.database, request.caller, snapshot);

  return readPublishedThreadEventWindow({
    database: request.database,
    limit,
    sessionId: toBackingSessionId(request.threadId),
  });
}
