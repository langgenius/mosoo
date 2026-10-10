import { sessionEventsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { createSessionRuntimeEventProjection } from "../domain/session-runtime-event-projection";
import { projectSessionViewerRuntimeEvents } from "./session-viewer-event-projection.repository";

export interface SessionRuntimeEventInput {
  readonly event: RuntimeEventEnvelope;
  readonly occurredAt: number | null;
  readonly sourceEventId: string | null;
}

export interface PersistSessionRuntimeEventsResult {
  readonly persistedCount: number;
  readonly persistedEvents: readonly RuntimeEventEnvelope[];
  readonly persistedSourceEventIds: readonly string[];
}

export interface SessionRuntimeEventSourceReceipt {
  readonly canonicalEventJson: string | null;
  readonly eventId: string;
  readonly seq: number;
  readonly type: string;
}

interface SourcedRuntimeEvent {
  readonly event: RuntimeEventEnvelope;
  readonly occurredAt: number | null;
  readonly sourceEventId: string;
}

interface ProjectedRuntimeEvent extends SourcedRuntimeEvent {
  readonly projection: ReturnType<typeof createSessionRuntimeEventProjection>;
}

interface InsertedSessionEventRow {
  readonly sessionId: SessionId;
  readonly sourceEventId: string;
}

type SessionEventInsertRow = Omit<typeof sessionEventsTable.$inferSelect, "agentId" | "seq">;
const WRITABLE_SESSION_STATUSES = ["IDLE", "RUNNING", "RESCHEDULING"] as const;
const TERMINAL_LIFECYCLE_WRITABLE_SESSION_STATUSES = [
  ...WRITABLE_SESSION_STATUSES,
  "TERMINATED",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalSessionLifecycleEvent(event: RuntimeEventEnvelope): boolean {
  return (
    event.kind === "session.lifecycle.updated" &&
    isRecord(event.payload) &&
    event.payload["status"] === "TERMINATED"
  );
}

function canWriteAfterTerminatedSession(
  records: readonly { event: RuntimeEventEnvelope }[],
): boolean {
  return (
    records.length > 0 && records.every((record) => isTerminalSessionLifecycleEvent(record.event))
  );
}

function sessionWritableStatusValues(allowTerminatedSession: boolean) {
  return allowTerminatedSession
    ? TERMINAL_LIFECYCLE_WRITABLE_SESSION_STATUSES
    : WRITABLE_SESSION_STATUSES;
}

function readSessionRuntimeEventSourceEventId(input: {
  event: RuntimeEventEnvelope;
  sourceEventId: string | null;
}): string {
  return input.sourceEventId ?? input.event.sourceEventId ?? input.event.id;
}

function readRuntimeEventEndedAt(event: RuntimeEventEnvelope, fallbackMs: number): number {
  const endedAt = Date.parse(event.occurredAt);
  return Number.isFinite(endedAt) && endedAt >= fallbackMs ? endedAt : fallbackMs;
}

function writableSessionCondition(input: {
  allowTerminatedSession: boolean;
  sessionId: SessionId;
}) {
  return and(
    eq(sessionsTable.id, input.sessionId),
    isNull(sessionsTable.archivedAt),
    inArray(sessionsTable.status, sessionWritableStatusValues(input.allowTerminatedSession)),
  )!;
}

async function assertSessionWritable(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    sessionId: SessionId;
  },
): Promise<void> {
  const session = await getAppDatabase(database)
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(writableSessionCondition(input))
    .get();
  if (session === undefined) {
    throw new Error(`Session ${input.sessionId} is not writable for runtime events.`);
  }
}

function projectRuntimeEvent(record: SourcedRuntimeEvent): ProjectedRuntimeEvent {
  return { ...record, projection: createSessionRuntimeEventProjection(record.event) };
}

function toSessionEventInsertValue(input: {
  record: ProjectedRuntimeEvent;
  sessionId: SessionId;
  sourceIndex: number;
  timestampMs: number;
}): SessionEventInsertRow {
  const { projection } = input.record;
  const occurredAt = input.record.occurredAt ?? input.timestampMs + input.sourceIndex;

  return {
    canonicalEventJson: canonicalRuntimeEventJson(input.record.event),
    contentText: projection.contentText,
    createdAt: input.timestampMs + input.sourceIndex,
    endedAt: readRuntimeEventEndedAt(input.record.event, occurredAt),
    eventType: projection.eventType,
    family: projection.family,
    id: createPlatformId<RuntimeEventId>(),
    occurredAt,
    processStatus: projection.processStatus,
    processType: projection.processType,
    runId: projection.runId,
    sessionId: input.sessionId,
    sourceEventId: input.record.sourceEventId,
    source: projection.source,
    toolCallId: projection.toolCallId,
    toolInputJson: projection.toolInputJson,
    toolName: projection.toolName,
    tokens: projection.tokens,
    traceId: projection.traceId,
    visibility: projection.visibility,
  };
}

async function insertSessionEventRows(
  database: D1Database,
  values: readonly SessionEventInsertRow[],
  writable: SQL,
): Promise<InsertedSessionEventRow[]> {
  if (values.length === 0) {
    return [];
  }

  const appDatabase = getAppDatabase(database);
  const statements: D1PreparedStatement[] = [];

  for (const row of values) {
    const query = createSessionEventInsert(appDatabase, row, writable)
      .onConflictDoNothing({
        target: [sessionEventsTable.sessionId, sessionEventsTable.sourceEventId],
      })
      .returning({
        sessionId: sessionEventsTable.sessionId,
        sourceEventId: sessionEventsTable.sourceEventId,
      })
      .toSQL();

    statements.push(database.prepare(query.sql).bind(...query.params));
    const cursorUpdate = advanceSessionEventCursor(appDatabase, row).toSQL();
    statements.push(database.prepare(cursorUpdate.sql).bind(...cursorUpdate.params));
  }

  const results = await database.batch<{ session_id: SessionId; source_event_id: string }>(
    statements,
  );

  return results.flatMap((result) =>
    result.results.map((row) => ({
      sessionId: row.session_id,
      sourceEventId: row.source_event_id,
    })),
  );
}

async function filterNewSessionRuntimeEvents(
  database: D1Database,
  input: {
    records: readonly SessionRuntimeEventInput[];
    sessionId: SessionId;
  },
): Promise<SourcedRuntimeEvent[]> {
  const records = input.records.map((record) => ({
    event: record.event,
    occurredAt: record.occurredAt,
    sourceEventId: readSessionRuntimeEventSourceEventId(record),
  }));
  const persistedReceipts = await getSessionRuntimeEventSourceReceipts(database, {
    sessionId: input.sessionId,
    sourceEventIds: records.map((record) => record.sourceEventId),
  });
  const acceptedSourceIds = new Set<string>();

  return records.filter((record) => {
    if (
      persistedReceipts.has(record.sourceEventId) ||
      acceptedSourceIds.has(record.sourceEventId)
    ) {
      return false;
    }

    acceptedSourceIds.add(record.sourceEventId);
    return true;
  });
}

// Sort object keys so JSON field order cannot change a durable source identity.
export function canonicalRuntimeEventJson(event: RuntimeEventEnvelope): string {
  return JSON.stringify(event, (_key, value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : value,
  );
}

export type PreparedSessionRuntimeEventInsert = NonNullable<
  Awaited<ReturnType<typeof prepareSessionRuntimeEventInsert>>
>;

export async function prepareSessionRuntimeEventInsert(
  database: D1Database,
  input: { record: SessionRuntimeEventInput; sessionId: SessionId },
) {
  const sourceEventId = readSessionRuntimeEventSourceEventId(input.record);
  const receipt = (
    await getSessionRuntimeEventSourceReceipts(database, {
      sessionId: input.sessionId,
      sourceEventIds: [sourceEventId],
    })
  ).get(sourceEventId);
  if (receipt !== undefined) {
    if (receipt.canonicalEventJson !== canonicalRuntimeEventJson(input.record.event)) {
      throw new Error("Source event identity already belongs to a different runtime event.");
    }
    return null;
  }
  const writableInput = {
    allowTerminatedSession: canWriteAfterTerminatedSession([input.record]),
    sessionId: input.sessionId,
  };
  await assertSessionWritable(database, writableInput);
  const writable = writableSessionCondition(writableInput);
  const row = toSessionEventInsertValue({
    record: projectRuntimeEvent({ ...input.record, sourceEventId }),
    sessionId: input.sessionId,
    sourceIndex: 0,
    timestampMs: currentTimestampMs(),
  });
  return {
    row,
    writableCondition: exists(
      getAppDatabase(database).select({ id: sessionsTable.id }).from(sessionsTable).where(writable),
    ),
    // Sequence assignment and visibility must commit together for cursor readers.
    writes(db: AppDatabase, condition: SQL) {
      return [
        createSessionEventInsert(db, row, and(writable, condition)!),
        advanceSessionEventCursor(db, row),
      ] as const;
    },
  };
}

function createSessionEventInsert(db: AppDatabase, row: SessionEventInsertRow, condition: SQL) {
  return db.insert(sessionEventsTable).select(
    db
      .select({
        agentId: sessionsTable.agentId,
        canonicalEventJson: sql<typeof row.canonicalEventJson>`${row.canonicalEventJson}`.as(
          "canonical_event_json",
        ),
        contentText: sql<typeof row.contentText>`${row.contentText}`.as("content_text"),
        createdAt: sql<typeof row.createdAt>`${row.createdAt}`.as("created_at"),
        endedAt: sql<typeof row.endedAt>`${row.endedAt}`.as("ended_at"),
        eventType: sql<typeof row.eventType>`${row.eventType}`.as("event_type"),
        family: sql<typeof row.family>`${row.family}`.as("family"),
        id: sql<typeof row.id>`${row.id}`.as("id"),
        occurredAt: sql<typeof row.occurredAt>`${row.occurredAt}`.as("occurred_at"),
        processStatus: sql<typeof row.processStatus>`${row.processStatus}`.as("process_status"),
        processType: sql<typeof row.processType>`${row.processType}`.as("process_type"),
        runId: sql<typeof row.runId>`${row.runId}`.as("run_id"),
        seq: sql<number>`${sessionsTable.runtimeEventSeqCursor} + 1`.as("seq"),
        sessionId: sessionsTable.id,
        sourceEventId: sql<typeof row.sourceEventId>`${row.sourceEventId}`.as("source_event_id"),
        source: sql<typeof row.source>`${row.source}`.as("source"),
        toolCallId: sql<typeof row.toolCallId>`${row.toolCallId}`.as("tool_call_id"),
        toolInputJson: sql<typeof row.toolInputJson>`${row.toolInputJson}`.as("tool_input_json"),
        toolName: sql<typeof row.toolName>`${row.toolName}`.as("tool_name"),
        tokens: sql<typeof row.tokens>`${row.tokens}`.as("tokens"),
        traceId: sql<typeof row.traceId>`${row.traceId}`.as("trace_id"),
        visibility: sql<typeof row.visibility>`${row.visibility}`.as("visibility"),
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, row.sessionId), condition)),
  );
}

function advanceSessionEventCursor(db: AppDatabase, row: SessionEventInsertRow) {
  const insertedEvent = db
    .select({ seq: sessionEventsTable.seq })
    .from(sessionEventsTable)
    .where(eq(sessionEventsTable.id, row.id));
  return db
    .update(sessionsTable)
    .set({
      runtimeEventSeqCursor: sql`max(${sessionsTable.runtimeEventSeqCursor}, (${insertedEvent}))`,
    })
    .where(and(eq(sessionsTable.id, row.sessionId), exists(insertedEvent)));
}

export async function persistSessionRuntimeEvents(
  database: D1Database,
  input: {
    records: readonly SessionRuntimeEventInput[];
    sessionId: SessionId;
  },
): Promise<PersistSessionRuntimeEventsResult> {
  const records = (await filterNewSessionRuntimeEvents(database, input)).map(projectRuntimeEvent);

  if (records.length === 0) {
    return {
      persistedCount: 0,
      persistedEvents: [],
      persistedSourceEventIds: [],
    };
  }

  const writableInput = {
    allowTerminatedSession: canWriteAfterTerminatedSession(records),
    sessionId: input.sessionId,
  };
  await assertSessionWritable(database, writableInput);

  const timestampMs = currentTimestampMs();
  const insertedRows = await insertSessionEventRows(
    database,
    records.map((record, sourceIndex) =>
      toSessionEventInsertValue({
        record,
        sessionId: input.sessionId,
        sourceIndex,
        timestampMs,
      }),
    ),
    writableSessionCondition(writableInput),
  );
  if (insertedRows.length === 0) await assertSessionWritable(database, writableInput);
  const insertedSourceEventIds = new Set(insertedRows.map((row) => row.sourceEventId));
  const insertedRecords = records.filter((record) =>
    insertedSourceEventIds.has(record.sourceEventId),
  );

  await projectSessionViewerRuntimeEvents(
    database,
    insertedRecords.map((record) => ({
      event: record.event,
      occurredAt: record.occurredAt,
      sessionId: input.sessionId,
    })),
  );

  return {
    persistedCount: insertedRows.length,
    persistedEvents: insertedRecords.map((record) => record.event),
    persistedSourceEventIds: insertedRows.map((row) => row.sourceEventId),
  };
}

export async function getSessionRuntimeEventSourceReceipts(
  database: D1Database,
  input: {
    sessionId: SessionId;
    sourceEventIds: string[];
  },
): Promise<Map<string, SessionRuntimeEventSourceReceipt>> {
  const sourceEventIds = [...new Set(input.sourceEventIds.filter((eventId) => eventId.length > 0))];

  if (sourceEventIds.length === 0) {
    return new Map<string, SessionRuntimeEventSourceReceipt>();
  }

  const rows = await getAppDatabase(database)
    .select({
      canonicalEventJson: sessionEventsTable.canonicalEventJson,
      event_id: sessionEventsTable.sourceEventId,
      seq: sessionEventsTable.seq,
      type: sessionEventsTable.eventType,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        inArray(sessionEventsTable.sourceEventId, sourceEventIds),
      ),
    )
    .all();

  const receipts = new Map<string, SessionRuntimeEventSourceReceipt>();

  for (const row of rows) {
    receipts.set(row.event_id, {
      canonicalEventJson: row.canonicalEventJson,
      eventId: row.event_id,
      seq: row.seq,
      type: row.type,
    });
  }

  return receipts;
}
