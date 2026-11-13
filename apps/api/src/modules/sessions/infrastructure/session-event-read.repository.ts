import type { SessionProcessEventStatus, SessionProcessEventType } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { and, asc, desc, eq, gt, inArray, lte, lt, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { createStreamedSessionEventRowFolder } from "../domain/session-event-stream-fold";
import type { StreamFoldableSessionEventRow } from "../domain/session-event-stream-fold";

// Count JSON bytes so escaped text is bounded too; JS strings need at most twice this space.
export const SESSION_EVENT_WINDOW_MAX_BYTES = 20 * 1024 * 1024;
export const SESSION_EVENT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_EVENT_PAGE_MAX_ROWS = 256;
const SESSION_EVENT_METADATA_PAGE_ROWS = 1000;

export interface SessionEventProcessRow extends StreamFoldableSessionEventRow {
  process_status: SessionProcessEventStatus;
  process_type: SessionProcessEventType;
  tool_call_id: string | null;
  tool_input_json: string | null;
  tool_name: string | null;
  usage_key?: string | null;
}

export function sessionEventThoughtColumns() {
  return {
    thought_id: sql<string | null>`CASE WHEN ${sessionEventsTable.eventType} LIKE 'thought.%'
      THEN ${sessionEventsTable.canonicalEventJson} ->> '$.payload.thoughtId' END`,
    thought_offset: sql<number | null>`CASE WHEN ${sessionEventsTable.eventType} = 'thought.updated'
      THEN json_extract(${sessionEventsTable.canonicalEventJson}, '$.payload.offset') END`,
  };
}

interface SessionEventReadRange {
  afterSeq?: number;
  beforeSeq?: number;
  eventTypes?: readonly string[];
  throughSeq?: number;
  sessionId: SessionId;
}

function rangeConditions(input: SessionEventReadRange) {
  return and(
    eq(sessionEventsTable.sessionId, input.sessionId),
    eq(sessionEventsTable.visibility, "all_consumers"),
    input.eventTypes === undefined
      ? undefined
      : inArray(sessionEventsTable.eventType, input.eventTypes),
    input.afterSeq === undefined ? undefined : gt(sessionEventsTable.seq, input.afterSeq),
    input.beforeSeq === undefined ? undefined : lt(sessionEventsTable.seq, input.beforeSeq),
    input.throughSeq === undefined ? undefined : lte(sessionEventsTable.seq, input.throughSeq),
  );
}

function readSessionEventMetadata(
  database: D1Database,
  input: SessionEventReadRange & { descending: boolean; limit: number },
) {
  const { thought_id } = sessionEventThoughtColumns();
  return getAppDatabase(database)
    .select({
      bytes: sql<number>`512 + length(CAST(json_quote(${sessionEventsTable.contentText}) AS BLOB))
        + length(CAST(json_quote(${sessionEventsTable.toolInputJson}) AS BLOB))
        + length(CAST(json_quote(${sessionEventsTable.toolCallId}) AS BLOB))
        + length(CAST(json_quote(${sessionEventsTable.toolName}) AS BLOB))
        + length(CAST(json_quote(${thought_id}) AS BLOB))`,
      occurred_at: sessionEventsTable.occurredAt,
      seq: sessionEventsTable.seq,
    })
    .from(sessionEventsTable)
    .where(rangeConditions(input))
    .orderBy(input.descending ? desc(sessionEventsTable.seq) : asc(sessionEventsTable.seq))
    .limit(input.limit)
    .all();
}

export interface SessionEventReadWindow {
  latestSeq: number | null;
  oldestOccurredAt: number | null;
  oldestSeq: number | null;
  rowCount: number;
  truncated: boolean;
}

export async function readSessionEventWindow(
  database: D1Database,
  input: { eventTypes?: readonly string[]; rowLimit: number; sessionId: SessionId },
): Promise<SessionEventReadWindow> {
  const window: SessionEventReadWindow = {
    latestSeq: null,
    oldestOccurredAt: null,
    oldestSeq: null,
    rowCount: 0,
    truncated: false,
  };
  let beforeSeq: number | undefined;
  let bytes = 0;
  let rowCount = 0;

  for (;;) {
    const limit = Math.min(SESSION_EVENT_METADATA_PAGE_ROWS, input.rowLimit + 1 - rowCount);
    const rows = await readSessionEventMetadata(database, {
      ...input,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      descending: true,
      limit,
    });
    for (const row of rows) {
      window.latestSeq ??= row.seq;
      if (rowCount === input.rowLimit || bytes + row.bytes > SESSION_EVENT_WINDOW_MAX_BYTES) {
        window.truncated = true;
        return window;
      }
      bytes += row.bytes;
      rowCount++;
      window.rowCount = rowCount;
      window.oldestSeq = row.seq;
      window.oldestOccurredAt = row.occurred_at;
    }
    if (rows.length < limit) return window;
    beforeSeq = rows.at(-1)!.seq;
  }
}

export async function readSessionEventRowsAfterSeq(
  database: D1Database,
  input: SessionEventReadRange & { afterSeq: number },
): Promise<SessionEventProcessRow[]> {
  const metadata = await readSessionEventMetadata(database, {
    ...input,
    descending: false,
    limit: SESSION_EVENT_PAGE_MAX_ROWS,
  });
  let bytes = 0;
  let throughSeq: number | undefined;
  for (const row of metadata) {
    // A single existing D1 row may exceed the page target; it must still make progress.
    if (throughSeq !== undefined && bytes + row.bytes > SESSION_EVENT_PAGE_MAX_BYTES) break;
    bytes += row.bytes;
    throughSeq = row.seq;
  }
  if (throughSeq === undefined) return [];

  return getAppDatabase(database)
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
      ...sessionEventThoughtColumns(),
      tool_call_id: sessionEventsTable.toolCallId,
      tool_input_json: sessionEventsTable.toolInputJson,
      tool_name: sessionEventsTable.toolName,
      tokens: sessionEventsTable.tokens,
      usage_key: sql<string | null>`CASE
        WHEN ${sessionEventsTable.eventType} = 'usage.updated'
          AND ${sessionEventsTable.canonicalEventJson} IS NOT NULL
        THEN COALESCE(json_extract(${sessionEventsTable.canonicalEventJson}, '$.payload.callId'), '')
        END`.mapWith((value: string) => {
        // Match the ledger's JavaScript trim, including non-space whitespace.
        const callId = value.trim();
        return callId.length > 0 ? `model_call:${callId}` : "run_usage";
      }),
    })
    .from(sessionEventsTable)
    .where(rangeConditions({ ...input, throughSeq }))
    .orderBy(asc(sessionEventsTable.seq))
    .all();
}

export async function readFoldedSessionEventRows(
  database: D1Database,
  input: { sessionId: SessionId; window: SessionEventReadWindow },
): Promise<SessionEventProcessRow[]> {
  const folder = createStreamedSessionEventRowFolder<SessionEventProcessRow>();
  const { window } = input;
  let afterSeq = (window.oldestSeq ?? 1) - 1;
  while (window.latestSeq !== null && window.oldestSeq !== null && afterSeq < window.latestSeq) {
    const rows = await readSessionEventRowsAfterSeq(database, {
      afterSeq,
      sessionId: input.sessionId,
      throughSeq: window.latestSeq,
    });
    if (rows.length === 0) break;
    folder.append(rows);
    afterSeq = rows.at(-1)!.seq;
  }
  return folder.finish();
}
