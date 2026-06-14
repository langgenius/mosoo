import { sessionEventsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { createSessionRuntimeEventProjection } from "../domain/session-runtime-event-projection";
import type {
  InsertSessionEventResult,
  OneRuntimeEventPerSessionAllocation,
  OneRuntimeEventPerSessionInput,
  OneRuntimeEventPerSessionRowInput,
  PersistOneRuntimeEventPerSessionResult,
  PersistSessionRuntimeEventsInput,
  PersistSessionRuntimeEventsResult,
  ProjectedSessionRuntimeEventInput,
  ProjectedSessionRuntimeEventRowInput,
  SerializedSessionRuntimeEventInput,
  SessionEventInsertValue,
  SessionRuntimeEventBatchAllocation,
  SessionRuntimeEventInput,
  SessionRuntimeEventRecord,
  SessionRuntimeEventSourceReceipt,
} from "./session-runtime-event-store.types";
import { appSessionViewerRuntimeEvents } from "./session-viewer-event-projection.repository";

export type {
  OneRuntimeEventPerSessionInput,
  PersistOneRuntimeEventPerSessionResult,
  PersistSessionRuntimeEventsResult,
  SessionRuntimeEventInput,
  SessionRuntimeEventRecord,
  SessionRuntimeEventSourceReceipt,
} from "./session-runtime-event-store.types";

const MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS = 5;
const WRITABLE_SESSION_STATUSES = ["IDLE", "RUNNING", "RESCHEDULING"] as const;
const TERMINAL_LIFECYCLE_WRITABLE_SESSION_STATUSES = [
  ...WRITABLE_SESSION_STATUSES,
  "TERMINATED",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTerminalSessionLifecycleEvent(event: SessionRuntimeEventRecord): boolean {
  return (
    event.kind === "session.lifecycle.updated" &&
    isRecord(event.payload) &&
    event.payload["status"] === "TERMINATED"
  );
}

function canWriteAfterTerminatedSession(
  records: readonly { event: SessionRuntimeEventRecord }[],
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

function sessionSourceEventKey(input: { sessionId: SessionId; sourceEventId: string }): string {
  return `${input.sessionId}:${input.sourceEventId}`;
}

function readErrorMessageTree(error: unknown, seen: Set<unknown> = new Set()): string {
  if (error === null || error === undefined || seen.has(error)) {
    return "";
  }

  seen.add(error);

  if (typeof error === "string") {
    return error;
  }

  if (typeof error !== "object") {
    return "";
  }

  const message = error instanceof Error ? error.message : "";
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeMessage = readErrorMessageTree(cause, seen);

  return `${message}\n${causeMessage}`;
}

function isSessionRuntimeEventSeqConflict(error: unknown): boolean {
  const errorText = readErrorMessageTree(error);

  return (
    errorText.includes("session_event_session_seq_idx") ||
    errorText.includes("session_event.session_id, session_event.seq")
  );
}

function readRuntimeEventEndedAt(event: SessionRuntimeEventRecord, fallbackMs: number): number {
  const endedAt = Date.parse(event.occurredAt);
  return Number.isFinite(endedAt) && endedAt >= fallbackMs ? endedAt : fallbackMs;
}

async function allocateSessionRuntimeEventBatch(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    count: number;
    sessionId: SessionId;
  },
): Promise<SessionRuntimeEventBatchAllocation> {
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

  if (session === null) {
    throw new Error(`Session ${input.sessionId} is not writable for runtime events.`);
  }

  return {
    agentId: session.agentId,
    firstSeq: session.seqCursor - input.count + 1,
  };
}

async function persistSessionRuntimeEventRows(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    rows: SerializedSessionRuntimeEventInput[];
    sessionId: SessionId;
  },
): Promise<InsertSessionEventResult> {
  if (input.rows.length === 0) {
    return {
      insertedCount: 0,
      insertedRows: [],
      insertedSessionIds: [],
      insertedSourceEventIds: [],
    };
  }

  const projectedRows = input.rows.map((row, sourceIndex) => ({
    row: {
      ...row,
      projection: createSessionRuntimeEventProjection(row.event),
    },
    sourceIndex,
  }));
  const timestampMs = currentTimestampMs();

  for (let attempt = 0; attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS; attempt += 1) {
    const allocation = await allocateSessionRuntimeEventBatch(database, {
      allowTerminatedSession: input.allowTerminatedSession,
      count: projectedRows.length,
      sessionId: input.sessionId,
    });

    try {
      return await insertSessionRuntimeEventRows(database, {
        allocation,
        rows: projectedRows,
        sessionId: input.sessionId,
        timestampMs,
      });
    } catch (error) {
      if (
        attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS - 1 &&
        isSessionRuntimeEventSeqConflict(error)
      ) {
        continue;
      }

      throw error;
    }
  }

  return {
    insertedCount: 0,
    insertedRows: [],
    insertedSessionIds: [],
    insertedSourceEventIds: [],
  };
}

function assertUniqueRuntimeEventSessions(
  records: readonly OneRuntimeEventPerSessionInput[],
): void {
  const seenSessionIds = new Set<SessionId>();

  for (const record of records) {
    if (seenSessionIds.has(record.sessionId)) {
      throw new Error(
        `Expected one runtime event per session, but received duplicate session ${record.sessionId}.`,
      );
    }

    seenSessionIds.add(record.sessionId);
  }
}

function assertRuntimeEventSessionMatches(input: {
  event: SessionRuntimeEventRecord;
  sessionId: SessionId;
}): void {
  if (input.event.sessionId !== input.sessionId) {
    throw new Error("Runtime event session id does not match the persistence session.");
  }
}

function assertRuntimeEventBatchSessionMatches(input: PersistSessionRuntimeEventsInput): void {
  for (const record of input.records) {
    assertRuntimeEventSessionMatches({
      event: record.event,
      sessionId: input.sessionId,
    });
  }
}

function assertOneRuntimeEventPerSessionMatches(
  records: readonly OneRuntimeEventPerSessionInput[],
): void {
  for (const record of records) {
    assertRuntimeEventSessionMatches({
      event: record.event,
      sessionId: record.sessionId,
    });
  }
}

interface RuntimeEventRunScope {
  runId: SessionRunId;
  sessionId: SessionId;
}

function readRuntimeEventRunScopes(
  records: readonly {
    event: SessionRuntimeEventRecord;
    sessionId: SessionId;
  }[],
): RuntimeEventRunScope[] {
  return records.flatMap((record) =>
    record.event.runId === undefined
      ? []
      : [
          {
            runId: record.event.runId,
            sessionId: record.sessionId,
          },
        ],
  );
}

async function ensureRuntimeEventRunsMatchSessions(
  database: D1Database,
  scopes: readonly RuntimeEventRunScope[],
): Promise<void> {
  if (scopes.length === 0) {
    return;
  }

  const expectedSessionByRunId = new Map<SessionRunId, SessionId>();

  for (const scope of scopes) {
    const existingSessionId = expectedSessionByRunId.get(scope.runId);

    if (existingSessionId !== undefined && existingSessionId !== scope.sessionId) {
      throw new Error("Runtime event run id does not belong to the persistence session.");
    }

    expectedSessionByRunId.set(scope.runId, scope.sessionId);
  }

  const rows = await getAppDatabase(database)
    .select({
      runId: sessionRunsTable.id,
      sessionId: sessionRunsTable.sessionId,
    })
    .from(sessionRunsTable)
    .where(inArray(sessionRunsTable.id, [...expectedSessionByRunId.keys()]))
    .all();

  if (rows.length !== expectedSessionByRunId.size) {
    throw new Error("Runtime event run id does not belong to the persistence session.");
  }

  for (const row of rows) {
    if (expectedSessionByRunId.get(row.runId) !== row.sessionId) {
      throw new Error("Runtime event run id does not belong to the persistence session.");
    }
  }
}

async function allocateOneRuntimeEventPerSession(
  database: D1Database,
  records: readonly OneRuntimeEventPerSessionInput[],
): Promise<Map<SessionId, OneRuntimeEventPerSessionAllocation>> {
  const sessionIds = [...new Set(records.map((record) => record.sessionId))];
  const recordsBySessionId = new Map(records.map((record) => [record.sessionId, record]));
  const allocations = new Map<SessionId, OneRuntimeEventPerSessionAllocation>();
  const appDb = getAppDatabase(database);

  for (const sessionId of sessionIds) {
    const record = recordsBySessionId.get(sessionId);
    const allowTerminatedSession =
      record === undefined ? false : canWriteAfterTerminatedSession([record]);
    const session =
      (await appDb
        .update(sessionsTable)
        .set({
          runtimeEventSeqCursor: sql`${sessionsTable.runtimeEventSeqCursor} + 1`,
        })
        .where(
          and(
            eq(sessionsTable.id, sessionId),
            isNull(sessionsTable.archivedAt),
            inArray(sessionsTable.status, sessionWritableStatusValues(allowTerminatedSession)),
          ),
        )
        .returning({
          agentId: sessionsTable.agentId,
          seq: sessionsTable.runtimeEventSeqCursor,
          sessionId: sessionsTable.id,
        })
        .get()) ?? null;

    if (session !== null) {
      allocations.set(session.sessionId, {
        agentId: session.agentId,
        seq: session.seq,
        sessionId: session.sessionId,
      });
    }
  }

  return allocations;
}

function toOneRuntimeEventPerSessionRows(
  records: readonly OneRuntimeEventPerSessionInput[],
): OneRuntimeEventPerSessionRowInput[] {
  return records.map((record) => ({
    event: record.event,
    occurredAt: record.occurredAt,
    projection: createSessionRuntimeEventProjection(record.event),
    sessionId: record.sessionId,
    sourceEventId: readSessionRuntimeEventSourceEventId({
      event: record.event,
      sourceEventId: null,
    }),
  }));
}

function readSessionRuntimeEventSourceEventId(input: {
  event: SessionRuntimeEventRecord;
  sourceEventId: string | null;
}): string {
  return input.sourceEventId ?? input.event.sourceEventId ?? input.event.id;
}

function toOneRuntimeEventPerSessionInsertValues(input: {
  allocations: Map<SessionId, OneRuntimeEventPerSessionAllocation>;
  rows: readonly OneRuntimeEventPerSessionRowInput[];
  timestampMs: number;
}): SessionEventInsertValue[] {
  return input.rows.flatMap((row) => {
    const allocation = input.allocations.get(row.sessionId);

    if (!allocation) {
      return [];
    }

    return [
      toSessionRuntimeEventInsertValue({
        allocation: {
          agentId: allocation.agentId,
          firstSeq: allocation.seq,
        },
        row,
        sessionId: row.sessionId,
        sourceIndex: 0,
        timestampMs: input.timestampMs,
      }),
    ];
  });
}

async function insertSessionEventRows(
  database: D1Database,
  values: readonly SessionEventInsertValue[],
): Promise<InsertSessionEventResult> {
  if (values.length === 0) {
    return {
      insertedCount: 0,
      insertedRows: [],
      insertedSessionIds: [],
      insertedSourceEventIds: [],
    };
  }

  const insertedRows = await getAppDatabase(database)
    .insert(sessionEventsTable)
    .values([...values])
    .onConflictDoNothing({
      target: [sessionEventsTable.sessionId, sessionEventsTable.sourceEventId],
    })
    .returning({
      sessionId: sessionEventsTable.sessionId,
      sourceEventId: sessionEventsTable.sourceEventId,
    })
    .all();

  return {
    insertedCount: insertedRows.length,
    insertedRows,
    insertedSessionIds: insertedRows.map((row) => row.sessionId),
    insertedSourceEventIds: insertedRows.map((row) => row.sourceEventId),
  };
}

export async function persistOneRuntimeEventPerSession(
  database: D1Database,
  input: {
    records: readonly OneRuntimeEventPerSessionInput[];
  },
): Promise<PersistOneRuntimeEventPerSessionResult> {
  if (input.records.length === 0) {
    return {
      persistedCount: 0,
      skippedSessionIds: [],
    };
  }

  assertUniqueRuntimeEventSessions(input.records);
  assertOneRuntimeEventPerSessionMatches(input.records);
  await ensureRuntimeEventRunsMatchSessions(database, readRuntimeEventRunScopes(input.records));

  const rows = toOneRuntimeEventPerSessionRows(input.records);
  const timestampMs = currentTimestampMs();

  for (let attempt = 0; attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS; attempt += 1) {
    const allocations = await allocateOneRuntimeEventPerSession(database, input.records);
    const values = toOneRuntimeEventPerSessionInsertValues({
      allocations,
      rows,
      timestampMs,
    });

    try {
      const insertResult = await insertSessionEventRows(database, values);
      const insertedSessionIds = new Set(insertResult.insertedSessionIds);
      const insertedKeys = new Set(insertResult.insertedRows.map(sessionSourceEventKey));

      await appSessionViewerRuntimeEvents(
        database,
        rows.flatMap((row) =>
          insertedKeys.has(
            sessionSourceEventKey({
              sessionId: row.sessionId,
              sourceEventId: row.sourceEventId,
            }),
          )
            ? [
                {
                  event: row.event,
                  occurredAt: row.occurredAt,
                  sessionId: row.sessionId,
                },
              ]
            : [],
        ),
      );

      return {
        persistedCount: insertResult.insertedCount,
        skippedSessionIds: input.records.flatMap((record) =>
          allocations.has(record.sessionId) && insertedSessionIds.has(record.sessionId)
            ? []
            : [record.sessionId],
        ),
      };
    } catch (error) {
      if (
        attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS - 1 &&
        isSessionRuntimeEventSeqConflict(error)
      ) {
        continue;
      }

      throw error;
    }
  }

  return {
    persistedCount: 0,
    skippedSessionIds: input.records.map((record) => record.sessionId),
  };
}

function toSessionRuntimeEventInsertValue(input: {
  allocation: SessionRuntimeEventBatchAllocation;
  row: ProjectedSessionRuntimeEventInput;
  sessionId: SessionId;
  sourceIndex: number;
  timestampMs: number;
}): SessionEventInsertValue {
  const id = createPlatformId<RuntimeEventId>();
  const occurredAt = input.row.occurredAt ?? input.timestampMs + input.sourceIndex;

  return {
    agentId: input.allocation.agentId,
    contentText: input.row.projection.contentText,
    createdAt: input.timestampMs + input.sourceIndex,
    endedAt: readRuntimeEventEndedAt(input.row.event, occurredAt),
    eventType: input.row.projection.eventType,
    family: input.row.projection.family,
    id,
    occurredAt,
    processStatus: input.row.projection.processStatus,
    processType: input.row.projection.processType,
    runId: input.row.projection.runId,
    seq: input.allocation.firstSeq + input.sourceIndex,
    sessionId: input.sessionId,
    sourceEventId: input.row.sourceEventId,
    source: input.row.projection.source,
    tokens: input.row.projection.tokens,
    traceId: input.row.projection.traceId,
    visibility: input.row.projection.visibility,
  };
}

function toSessionRuntimeEventInsertValues(input: {
  allocation: SessionRuntimeEventBatchAllocation;
  rows: ProjectedSessionRuntimeEventRowInput[];
  sessionId: SessionId;
  timestampMs: number;
}): SessionEventInsertValue[] {
  return input.rows.map(({ row, sourceIndex }) =>
    toSessionRuntimeEventInsertValue({
      allocation: input.allocation,
      row,
      sessionId: input.sessionId,
      sourceIndex,
      timestampMs: input.timestampMs,
    }),
  );
}

async function insertSessionRuntimeEventRows(
  database: D1Database,
  input: {
    allocation: SessionRuntimeEventBatchAllocation;
    rows: ProjectedSessionRuntimeEventRowInput[];
    sessionId: SessionId;
    timestampMs: number;
  },
): Promise<InsertSessionEventResult> {
  return insertSessionEventRows(database, toSessionRuntimeEventInsertValues(input));
}

async function filterNewSessionRuntimeEventInputs(
  database: D1Database,
  input: PersistSessionRuntimeEventsInput,
): Promise<SessionRuntimeEventInput[]> {
  const sourceEventIds = input.records.map((record) =>
    readSessionRuntimeEventSourceEventId({
      event: record.event,
      sourceEventId: record.sourceEventId,
    }),
  );

  const persistedReceipts = await getSessionRuntimeEventSourceReceipts(database, {
    sessionId: input.sessionId,
    sourceEventIds,
  });
  const acceptedSourceIds = new Set<string>();

  return input.records.filter((record) => {
    const sourceEventId = readSessionRuntimeEventSourceEventId({
      event: record.event,
      sourceEventId: record.sourceEventId,
    });

    if (persistedReceipts.has(sourceEventId) || acceptedSourceIds.has(sourceEventId)) {
      return false;
    }

    acceptedSourceIds.add(sourceEventId);
    return true;
  });
}

export async function persistSessionRuntimeEvents(
  database: D1Database,
  input: PersistSessionRuntimeEventsInput,
): Promise<PersistSessionRuntimeEventsResult> {
  assertRuntimeEventBatchSessionMatches(input);
  await ensureRuntimeEventRunsMatchSessions(
    database,
    readRuntimeEventRunScopes(
      input.records.map((record) => ({
        event: record.event,
        sessionId: input.sessionId,
      })),
    ),
  );

  const records = await filterNewSessionRuntimeEventInputs(database, input);

  if (records.length === 0) {
    return {
      persistedCount: 0,
      persistedEvents: [],
      persistedSourceEventIds: [],
    };
  }

  const rows = records.map((record) => ({
    event: record.event,
    occurredAt: record.occurredAt,
    sourceEventId: readSessionRuntimeEventSourceEventId({
      event: record.event,
      sourceEventId: record.sourceEventId,
    }),
  }));
  const result = await persistSessionRuntimeEventRows(database, {
    allowTerminatedSession: canWriteAfterTerminatedSession(records),
    rows,
    sessionId: input.sessionId,
  });
  const insertedSourceEventIds = new Set(result.insertedSourceEventIds);

  await appSessionViewerRuntimeEvents(
    database,
    rows.flatMap((row) =>
      insertedSourceEventIds.has(row.sourceEventId)
        ? [
            {
              event: row.event,
              occurredAt: row.occurredAt,
              sessionId: input.sessionId,
            },
          ]
        : [],
    ),
  );

  return {
    persistedCount: result.insertedCount,
    persistedEvents: rows
      .filter((row) => insertedSourceEventIds.has(row.sourceEventId))
      .map((row) => row.event),
    persistedSourceEventIds: result.insertedSourceEventIds,
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
