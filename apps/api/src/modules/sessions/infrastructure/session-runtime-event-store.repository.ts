import { sessionEventsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, RuntimeEventId, SessionId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
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

// D1 accepts at most 100 bound parameters; each session_event row binds 21.
const MAX_SESSION_EVENT_ROWS_PER_INSERT = 4;
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

async function allocateSessionRuntimeEventSeq(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    count: number;
    sessionId: SessionId;
  },
): Promise<{ agentId: AgentId | null; firstSeq: number } | null> {
  const session =
    (await getAppDatabase(database)
      .update(sessionsTable)
      .set({
        runtimeEventSeqCursor: sql`${sessionsTable.runtimeEventSeqCursor} + ${input.count}`,
      })
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          isNull(sessionsTable.archivedAt),
          inArray(sessionsTable.status, sessionWritableStatusValues(input.allowTerminatedSession)),
        ),
      )
      .returning({
        agentId: sessionsTable.agentId,
        seqCursor: sessionsTable.runtimeEventSeqCursor,
      })
      .get()) ?? null;

  return session === null
    ? null
    : { agentId: session.agentId, firstSeq: session.seqCursor - input.count + 1 };
}

function projectRuntimeEvent(record: SourcedRuntimeEvent): ProjectedRuntimeEvent {
  return { ...record, projection: createSessionRuntimeEventProjection(record.event) };
}

function toSessionEventInsertValue(input: {
  agentId: AgentId | null;
  record: ProjectedRuntimeEvent;
  seq: number;
  sessionId: SessionId;
  sourceIndex: number;
  timestampMs: number;
}): typeof sessionEventsTable.$inferInsert {
  const { projection } = input.record;
  const occurredAt = input.record.occurredAt ?? input.timestampMs + input.sourceIndex;

  return {
    agentId: input.agentId,
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
    seq: input.seq,
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
  values: readonly (typeof sessionEventsTable.$inferInsert)[],
): Promise<InsertedSessionEventRow[]> {
  if (values.length === 0) {
    return [];
  }

  const appDatabase = getAppDatabase(database);
  const statements: D1PreparedStatement[] = [];

  for (let index = 0; index < values.length; index += MAX_SESSION_EVENT_ROWS_PER_INSERT) {
    const query = appDatabase
      .insert(sessionEventsTable)
      .values(values.slice(index, index + MAX_SESSION_EVENT_ROWS_PER_INSERT))
      .onConflictDoNothing({
        target: [sessionEventsTable.sessionId, sessionEventsTable.sourceEventId],
      })
      .returning({
        sessionId: sessionEventsTable.sessionId,
        sourceEventId: sessionEventsTable.sourceEventId,
      })
      .toSQL();

    statements.push(database.prepare(query.sql).bind(...query.params));
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

  const allocation = await allocateSessionRuntimeEventSeq(database, {
    allowTerminatedSession: canWriteAfterTerminatedSession(records),
    count: records.length,
    sessionId: input.sessionId,
  });

  if (allocation === null) {
    throw new Error(`Session ${input.sessionId} is not writable for runtime events.`);
  }

  const timestampMs = currentTimestampMs();
  const insertedRows = await insertSessionEventRows(
    database,
    records.map((record, sourceIndex) =>
      toSessionEventInsertValue({
        agentId: allocation.agentId,
        record,
        seq: allocation.firstSeq + sourceIndex,
        sessionId: input.sessionId,
        sourceIndex,
        timestampMs,
      }),
    ),
  );
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
      eventId: row.event_id,
      seq: row.seq,
      type: row.type,
    });
  }

  return receipts;
}
