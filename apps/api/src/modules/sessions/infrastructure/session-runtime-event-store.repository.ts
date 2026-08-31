import { parseNullableSessionUsageSummary } from "@mosoo/ag-ui-session";
import {
  driverInstancesTable,
  sessionEventsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import {
  createRuntimeEventSemanticHash,
  readRuntimeAgentTaskSnapshot,
  readRuntimeEventPayload,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import { and, eq, exists, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../runtime/domain/session-run-lifecycle.machine";
import { readNativeResumeRef } from "../../runtime/infrastructure/driver-instance/native-resume-ref-event";
import { prepareRuntimeArtifactPromotion } from "../../runtime/infrastructure/driver-instance/runtime-artifact-attempt.repository";
import { prepareNativeResumeRefProjection } from "../../runtime/infrastructure/native-resume-ref.repository";
import { prepareDurableSessionAutoTitleProjection } from "../application/session-title.service";
import { createSessionRuntimeEventProjection } from "../domain/session-runtime-event-projection";
import { normalizeSessionTitle } from "../domain/session-title";
import { prepareSessionAgentTaskSnapshotUpsert } from "./session-agent-task-snapshot.repository";
import { prepareDurableSessionModelCallUsageProjection } from "./session-model-call.repository";
import type {
  DriverRuntimeEventFence,
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
import { prepareSessionViewerRuntimeEventProjection } from "./session-viewer-event-projection.repository";

export type {
  OneRuntimeEventPerSessionInput,
  PersistOneRuntimeEventPerSessionResult,
  PersistSessionRuntimeEventsResult,
  SessionRuntimeEventInput,
  SessionRuntimeEventRecord,
  SessionRuntimeEventSourceReceipt,
} from "./session-runtime-event-store.types";

const MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS = 5;
// D1 accepts at most 100 bound parameters; the run-active fence adds its own binds.
const MAX_SESSION_EVENT_ROWS_PER_INSERT = 2;
const WRITABLE_SESSION_STATUSES = ["IDLE", "RUNNING", "RESCHEDULING"] as const;
const TERMINAL_LIFECYCLE_WRITABLE_SESSION_STATUSES = [
  ...WRITABLE_SESSION_STATUSES,
  "TERMINATED",
] as const;
const RUN_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "run.cancelled",
  "run.completed",
  "run.failed",
]);

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

function assertNoRunTerminalEvents(records: readonly { event: SessionRuntimeEventRecord }[]): void {
  if (records.some(({ event }) => RUN_TERMINAL_EVENT_TYPES.has(event.kind))) {
    throw new Error("Run terminal events require the atomic terminal-run projection.");
  }
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

function isSessionRuntimeEventBatchFenceConflict(error: unknown): boolean {
  const errorText = readErrorMessageTree(error);
  return (
    errorText.includes("NOT NULL constraint failed: session_event.agent_id") ||
    errorText.includes("NOT NULL constraint failed: session_event.session_id")
  );
}

function readRuntimeEventEndedAt(event: SessionRuntimeEventRecord, fallbackMs: number): number {
  const endedAt = Date.parse(event.occurredAt);
  return Number.isFinite(endedAt) && endedAt >= fallbackMs ? endedAt : fallbackMs;
}

function selectedValue<T>(value: T, alias: string) {
  return sql<T>`${value}`.as(alias);
}

async function readSessionRuntimeEventBatchAllocation(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    sessionId: SessionId;
  },
): Promise<SessionRuntimeEventBatchAllocation> {
  const session =
    (await getAppDatabase(database)
      .select({
        agentId: sessionsTable.agentId,
        seqCursor: sessionsTable.runtimeEventSeqCursor,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          isNull(sessionsTable.archivedAt),
          inArray(sessionsTable.status, sessionWritableStatusValues(input.allowTerminatedSession)),
        ),
      )
      .get()) ?? null;

  if (session === null) {
    throw new Error(`Session ${input.sessionId} is not writable for runtime events.`);
  }

  return {
    agentId: session.agentId,
    firstSeq: session.seqCursor + 1,
    previousCursor: session.seqCursor,
  };
}

async function persistSessionRuntimeEventRows(
  database: D1Database,
  input: {
    allowTerminatedSession: boolean;
    driverFence?: DriverRuntimeEventFence;
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

  let pendingRows = input.rows.map((row) => ({
    ...row,
    projection: createSessionRuntimeEventProjection(row.event, {
      provenMcpCommandId: row.provenMcpCommandId,
    }),
  }));
  const timestampMs = currentTimestampMs();

  for (let attempt = 0; attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS; attempt += 1) {
    if (pendingRows.length === 0) {
      return {
        insertedCount: 0,
        insertedRows: [],
        insertedSessionIds: [],
        insertedSourceEventIds: [],
      };
    }
    const allocation = await readSessionRuntimeEventBatchAllocation(database, {
      allowTerminatedSession: input.allowTerminatedSession,
      sessionId: input.sessionId,
    });
    const projectedRows = pendingRows.map((row, sourceIndex) => ({ row, sourceIndex }));

    try {
      return await insertSessionRuntimeEventRows(database, {
        allocation,
        allowTerminatedSession: input.allowTerminatedSession,
        ...(input.driverFence === undefined ? {} : { driverFence: input.driverFence }),
        rows: projectedRows,
        sessionId: input.sessionId,
        timestampMs,
      });
    } catch (error) {
      if (
        !isSessionRuntimeEventSeqConflict(error) &&
        !isSessionRuntimeEventBatchFenceConflict(error)
      ) {
        throw error;
      }
      const receipts = await getSessionRuntimeEventSourceReceipts(database, {
        sessionId: input.sessionId,
        sourceEventIds: pendingRows.map((row) => row.sourceEventId),
      });
      pendingRows = pendingRows.filter((row) => {
        const receipt = receipts.get(row.sourceEventId);
        if (receipt === undefined) {
          return true;
        }
        if (
          receipt.semanticHash !== row.semanticHash ||
          receipt.type !== row.projection.eventType
        ) {
          throw new Error(
            `Runtime event source ${row.sourceEventId} conflicts with its durable receipt.`,
            { cause: error },
          );
        }
        return false;
      });
      if (attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS - 1) {
        continue;
      }

      throw new Error("Runtime event batch lost its atomic session or active-run fence.", {
        cause: error,
      });
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
        .select({
          agentId: sessionsTable.agentId,
          previousCursor: sessionsTable.runtimeEventSeqCursor,
          sessionId: sessionsTable.id,
        })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.id, sessionId),
            isNull(sessionsTable.archivedAt),
            inArray(sessionsTable.status, sessionWritableStatusValues(allowTerminatedSession)),
          ),
        )
        .get()) ?? null;

    if (session !== null) {
      allocations.set(session.sessionId, {
        agentId: session.agentId,
        previousCursor: session.previousCursor,
        seq: session.previousCursor + 1,
        sessionId: session.sessionId,
      });
    }
  }

  return allocations;
}

async function toOneRuntimeEventPerSessionRows(
  records: readonly OneRuntimeEventPerSessionInput[],
): Promise<OneRuntimeEventPerSessionRowInput[]> {
  return Promise.all(
    records.map(async (record) => ({
      artifactAttemptId: null,
      artifactManifestJson: null,
      artifactManifestSha256: null,
      event: record.event,
      occurredAt: record.occurredAt,
      projection: createSessionRuntimeEventProjection(record.event),
      provenMcpCommandId: null,
      semanticHash: await createRuntimeEventSemanticHash(record.event),
      sessionId: record.sessionId,
      sourceEventId: readSessionRuntimeEventSourceEventId({
        event: record.event,
        sourceEventId: null,
      }),
    })),
  );
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

async function filterNewOneRuntimeEventPerSessionRows(
  database: D1Database,
  rows: readonly OneRuntimeEventPerSessionRowInput[],
): Promise<OneRuntimeEventPerSessionRowInput[]> {
  const results = await Promise.all(
    rows.map(async (row) => {
      const receipt = (
        await getSessionRuntimeEventSourceReceipts(database, {
          sessionId: row.sessionId,
          sourceEventIds: [row.sourceEventId],
        })
      ).get(row.sourceEventId);
      if (receipt === undefined) {
        return row;
      }
      if (receipt.semanticHash !== row.semanticHash || receipt.type !== row.projection.eventType) {
        throw new Error(
          `Runtime event source ${row.sourceEventId} conflicts with its durable receipt.`,
        );
      }
      return null;
    }),
  );

  return results.filter((row): row is OneRuntimeEventPerSessionRowInput => row !== null);
}

async function prepareDurableRuntimeEventSideEffectProjection(
  database: D1Database,
  value: SessionEventInsertValue,
  driverFence: DriverRuntimeEventFence | undefined,
): Promise<D1PreparedStatement[]> {
  if (driverFence === undefined) {
    return [];
  }

  if (value.event.kind === "session.info.updated") {
    const title = readRuntimeEventString(readRuntimeEventPayload(value.event), "title");

    if (title === null || title.trim().length === 0) {
      return [];
    }

    return prepareDurableSessionAutoTitleProjection(database, {
      createdAt: value.createdAt,
      eventId: value.id,
      eventSeq: value.seq,
      semanticHash: value.semanticHash,
      sessionId: value.sessionId,
      title: normalizeSessionTitle(title),
    });
  }

  if (value.event.kind === "usage.updated") {
    const usage = parseNullableSessionUsageSummary(value.event.payload);

    if (usage === null || driverFence.sessionRunId === null) {
      return [];
    }
    if (value.event.driverInstanceId !== driverFence.driverInstanceId) {
      throw new Error("Durable usage event is missing its exact Driver identity.");
    }
    if (value.runId !== driverFence.sessionRunId) {
      throw new Error("Durable usage event is missing its exact Session Run identity.");
    }

    return prepareDurableSessionModelCallUsageProjection(database, {
      createdAtMs: value.createdAt,
      driverInstanceId: driverFence.driverInstanceId,
      eventId: value.id,
      semanticHash: value.semanticHash,
      sessionId: value.sessionId,
      sessionRunId: driverFence.sessionRunId,
      sourceEventSeq: value.seq,
      traceId: value.traceId ?? driverFence.sessionRunId,
      usage,
    });
  }

  if (value.event.kind !== "runtime.resume.updated") {
    return [];
  }

  const nativeResumeRef = readNativeResumeRef(value.event);

  if (nativeResumeRef === null || driverFence.sessionRunId === null) {
    return [];
  }
  if (value.event.driverInstanceId !== driverFence.driverInstanceId) {
    throw new Error("Durable native resume event is missing its exact Driver identity.");
  }
  if (value.runId !== driverFence.sessionRunId) {
    throw new Error("Durable native resume event is missing its exact Session Run identity.");
  }

  return prepareNativeResumeRefProjection(database, {
    createdAt: value.createdAt,
    driverInstanceId: driverFence.driverInstanceId,
    eventId: value.id,
    nativeResumeRef,
    observedEventSeq: value.seq,
    semanticHash: value.semanticHash,
    sessionId: value.sessionId,
    sessionRunId: driverFence.sessionRunId,
  });
}

async function insertSessionEventRows(
  database: D1Database,
  values: readonly SessionEventInsertValue[],
  atomicAllocations?: ReadonlyMap<
    SessionId,
    {
      allowTerminatedSession: boolean;
      driverFence?: DriverRuntimeEventFence;
      previousCursor: number;
    }
  >,
): Promise<InsertSessionEventResult> {
  if (values.length === 0) {
    return {
      insertedCount: 0,
      insertedRows: [],
      insertedSessionIds: [],
      insertedSourceEventIds: [],
    };
  }

  const appDatabase = getAppDatabase(database);
  const statements: D1PreparedStatement[] = [];
  const receiptStatementIndexes: number[] = [];
  const valuesBySession = Map.groupBy(values, (value) => value.sessionId);
  const nextCursorBySession = new Map<SessionId, number>();

  for (const [sessionId, allocation] of atomicAllocations ?? []) {
    const sessionValues = valuesBySession.get(sessionId) ?? [];
    if (sessionValues.length === 0) {
      continue;
    }
    const nextCursor = allocation.previousCursor + sessionValues.length;
    nextCursorBySession.set(sessionId, nextCursor);
    const writableStatuses = sessionWritableStatusValues(allocation.allowTerminatedSession);
    statements.push(
      database
        .prepare(
          `UPDATE session
              SET runtime_event_seq_cursor = ?
            WHERE id = ?
              AND runtime_event_seq_cursor = ?
              AND archived_at IS NULL
              AND status IN (${writableStatuses.map(() => "?").join(", ")})`,
        )
        .bind(nextCursor, sessionId, allocation.previousCursor, ...writableStatuses),
    );
  }

  const insertSize = atomicAllocations === undefined ? MAX_SESSION_EVENT_ROWS_PER_INSERT : 1;
  for (let index = 0; index < values.length; index += insertSize) {
    const chunk = values.slice(index, index + insertSize);
    const firstValue = chunk[0];

    if (firstValue === undefined) {
      continue;
    }

    const selection = createSessionEventInsertSelect(
      appDatabase,
      firstValue,
      nextCursorBySession.get(firstValue.sessionId) ?? null,
      atomicAllocations?.get(firstValue.sessionId)?.driverFence,
    );

    for (const value of chunk.slice(1)) {
      selection.unionAll(
        createSessionEventInsertSelect(
          appDatabase,
          value,
          nextCursorBySession.get(value.sessionId) ?? null,
          atomicAllocations?.get(value.sessionId)?.driverFence,
        ),
      );
    }

    const query = appDatabase
      .insert(sessionEventsTable)
      .select(selection)
      .onConflictDoNothing({
        target: [sessionEventsTable.sessionId, sessionEventsTable.sourceEventId],
      })
      .returning({
        sessionId: sessionEventsTable.sessionId,
        sourceEventId: sessionEventsTable.sourceEventId,
      })
      .toSQL();

    receiptStatementIndexes.push(statements.length);
    statements.push(database.prepare(query.sql).bind(...query.params));

    for (const value of chunk) {
      if (value.agentTaskSnapshot !== null) {
        statements.push(
          prepareSessionAgentTaskSnapshotUpsert(database, {
            eventId: value.id,
            snapshot: value.agentTaskSnapshot,
          }),
        );
      }
      statements.push(
        ...prepareSessionViewerRuntimeEventProjection(database, {
          createdAt: value.createdAt,
          event: value.event,
          eventId: value.id,
          sessionId: value.sessionId,
        }),
      );
      statements.push(
        ...(await prepareDurableRuntimeEventSideEffectProjection(
          database,
          value,
          atomicAllocations?.get(value.sessionId)?.driverFence,
        )),
      );
      if (
        value.artifactAttemptId !== null &&
        value.artifactManifestJson !== null &&
        value.artifactManifestSha256 !== null
      ) {
        statements.push(
          ...prepareRuntimeArtifactPromotion(database, {
            attemptId: value.artifactAttemptId,
            eventId: value.id,
            manifestJson: value.artifactManifestJson,
            manifestSha256: value.artifactManifestSha256,
            timestampMs: value.createdAt,
          }),
        );
      }
    }
  }

  for (const [sessionId, nextCursor] of nextCursorBySession) {
    const sessionValues = valuesBySession.get(sessionId) ?? [];
    statements.push(
      database
        .prepare(
          `INSERT INTO session_event (id)
           SELECT ?
            WHERE NOT EXISTS (
              SELECT 1
                FROM session AS s
               WHERE s.id = ?
                 AND s.runtime_event_seq_cursor = ?
                 AND (
                   SELECT COUNT(*)
                     FROM session_event AS e
                    WHERE e.session_id = s.id
                      AND e.id IN (SELECT value FROM json_each(?))
                 ) = ?
            )`,
        )
        .bind(
          createPlatformId<RuntimeEventId>(),
          sessionId,
          nextCursor,
          JSON.stringify(sessionValues.map((value) => value.id)),
          sessionValues.length,
        ),
    );
  }

  const results = await database.batch<{ session_id: SessionId; source_event_id: string }>(
    statements,
  );
  const insertedRows = receiptStatementIndexes.flatMap((resultIndex) => {
    const result = results[resultIndex];

    return (result?.results ?? []).map((row) => ({
      sessionId: row.session_id,
      sourceEventId: row.source_event_id,
    }));
  });
  const insertedKeys = new Set(insertedRows.map(sessionSourceEventKey));
  const replayCandidates = values.filter(
    (value) =>
      !insertedKeys.has(
        sessionSourceEventKey({
          sessionId: value.sessionId,
          sourceEventId: value.sourceEventId,
        }),
      ),
  );
  const replayCandidatesBySession = new Map<SessionId, SessionEventInsertValue[]>();
  for (const candidate of replayCandidates) {
    replayCandidatesBySession.set(candidate.sessionId, [
      ...(replayCandidatesBySession.get(candidate.sessionId) ?? []),
      candidate,
    ]);
  }

  for (const [sessionId, candidates] of replayCandidatesBySession) {
    const receipts = await getSessionRuntimeEventSourceReceipts(database, {
      sessionId,
      sourceEventIds: candidates.map((candidate) => candidate.sourceEventId),
    });
    for (const candidate of candidates) {
      const receipt = receipts.get(candidate.sourceEventId);
      if (
        receipt === undefined ||
        receipt.semanticHash !== candidate.semanticHash ||
        receipt.type !== candidate.eventType
      ) {
        throw new Error(
          `Runtime event source ${candidate.sourceEventId} conflicts with its durable receipt.`,
        );
      }
    }
  }

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
  assertNoRunTerminalEvents(input.records);
  await ensureRuntimeEventRunsMatchSessions(database, readRuntimeEventRunScopes(input.records));

  const rows = await toOneRuntimeEventPerSessionRows(input.records);
  let pendingRows = await filterNewOneRuntimeEventPerSessionRows(database, rows);
  const timestampMs = currentTimestampMs();

  for (let attempt = 0; attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS; attempt += 1) {
    const allocations = await allocateOneRuntimeEventPerSession(database, pendingRows);
    const values = toOneRuntimeEventPerSessionInsertValues({
      allocations,
      rows: pendingRows,
      timestampMs,
    });
    const atomicAllocations = new Map(
      [...allocations].map(([sessionId, allocation]) => [
        sessionId,
        {
          allowTerminatedSession:
            pendingRows.find((row) => row.sessionId === sessionId) !== undefined &&
            canWriteAfterTerminatedSession(
              pendingRows.filter((row) => row.sessionId === sessionId),
            ),
          previousCursor: allocation.previousCursor,
        },
      ]),
    );

    try {
      const insertResult = await insertSessionEventRows(database, values, atomicAllocations);
      const insertedSessionIds = new Set(insertResult.insertedSessionIds);

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
        !isSessionRuntimeEventSeqConflict(error) &&
        !isSessionRuntimeEventBatchFenceConflict(error)
      ) {
        throw error;
      }
      pendingRows = await filterNewOneRuntimeEventPerSessionRows(database, pendingRows);
      if (attempt < MAX_SESSION_RUNTIME_EVENT_INSERT_ATTEMPTS - 1) {
        continue;
      }

      throw new Error("Runtime event batch lost its atomic session or active-run fence.", {
        cause: error,
      });
    }
  }

  return {
    persistedCount: 0,
    skippedSessionIds: input.records.map((record) => record.sessionId),
  };
}

function toSessionRuntimeEventInsertValue(input: {
  allocation: Pick<SessionRuntimeEventBatchAllocation, "agentId" | "firstSeq">;
  row: ProjectedSessionRuntimeEventInput;
  sessionId: SessionId;
  sourceIndex: number;
  timestampMs: number;
}): SessionEventInsertValue {
  const id = createPlatformId<RuntimeEventId>();
  const occurredAt = input.row.occurredAt ?? input.timestampMs + input.sourceIndex;

  return {
    agentTaskSnapshot:
      input.row.event.kind === "agent.tasks.replaced"
        ? readRuntimeAgentTaskSnapshot(input.row.event)
        : null,
    agentId: input.allocation.agentId,
    artifactAttemptId: input.row.artifactAttemptId,
    artifactManifestJson: input.row.artifactManifestJson,
    artifactManifestSha256: input.row.artifactManifestSha256,
    contentText: input.row.projection.contentText,
    createdAt: input.timestampMs + input.sourceIndex,
    endedAt: readRuntimeEventEndedAt(input.row.event, occurredAt),
    event: input.row.event,
    eventType: input.row.projection.eventType,
    family: input.row.projection.family,
    id,
    mcpCommandId: input.row.projection.mcpCommandId,
    occurredAt,
    processStatus: input.row.projection.processStatus,
    processType: input.row.projection.processType,
    runId: input.row.projection.runId,
    runtimeOperationEventJson: null,
    semanticHash: input.row.semanticHash,
    terminalEventJson: null,
    seq: input.allocation.firstSeq + input.sourceIndex,
    sessionId: input.sessionId,
    sourceEventId: input.row.sourceEventId,
    source: input.row.projection.source,
    streamId: input.row.projection.streamId,
    toolCallId: input.row.projection.toolCallId,
    toolInputDeltaJson: input.row.projection.toolInputDeltaJson,
    toolInputJson: input.row.projection.toolInputJson,
    toolName: input.row.projection.toolName,
    toolOutputDeltaText: input.row.projection.toolOutputDeltaText,
    toolOutputText: input.row.projection.toolOutputText,
    toolParentMessageId: input.row.projection.toolParentMessageId,
    toolResultMessageId: input.row.projection.toolResultMessageId,
    toolStatus: input.row.projection.toolStatus,
    tokens: input.row.projection.tokens,
    traceId: input.row.projection.traceId,
    visibility: input.row.projection.visibility,
  };
}

function createSessionEventInsertSelect(
  database: AppDatabase,
  value: SessionEventInsertValue,
  requiredCursor: number | null = null,
  driverFence?: DriverRuntimeEventFence,
) {
  return database
    .select({
      agentId: selectedValue(value.agentId, "agent_id"),
      artifactAttemptId: selectedValue(value.artifactAttemptId, "artifact_attempt_id"),
      artifactManifestJson: selectedValue(value.artifactManifestJson, "artifact_manifest_json"),
      artifactManifestSha256: selectedValue(
        value.artifactManifestSha256,
        "artifact_manifest_sha256",
      ),
      contentText: selectedValue(value.contentText, "content_text"),
      createdAt: selectedValue(value.createdAt, "created_at"),
      endedAt: selectedValue(value.endedAt, "ended_at"),
      eventType: selectedValue(value.eventType, "event_type"),
      family: selectedValue(value.family, "family"),
      id: selectedValue(value.id, "id"),
      mcpCommandId: selectedValue(value.mcpCommandId, "mcp_command_id"),
      occurredAt: selectedValue(value.occurredAt, "occurred_at"),
      processStatus: selectedValue(value.processStatus, "process_status"),
      processType: selectedValue(value.processType, "process_type"),
      runId: selectedValue(value.runId, "run_id"),
      runtimeOperationEventJson: selectedValue(
        value.runtimeOperationEventJson,
        "runtime_operation_event_json",
      ),
      semanticHash: selectedValue(value.semanticHash, "semantic_hash"),
      seq: selectedValue(value.seq, "seq"),
      sessionId: selectedValue(value.sessionId, "session_id"),
      sourceEventId: selectedValue(value.sourceEventId, "source_event_id"),
      source: selectedValue(value.source, "source"),
      streamId: selectedValue(value.streamId, "stream_id"),
      terminalEventJson: selectedValue(value.terminalEventJson, "terminal_event_json"),
      toolCallId: selectedValue(value.toolCallId, "tool_call_id"),
      toolInputDeltaJson: selectedValue(value.toolInputDeltaJson, "tool_input_delta_json"),
      toolInputJson: selectedValue(value.toolInputJson, "tool_input_json"),
      toolName: selectedValue(value.toolName, "tool_name"),
      toolOutputDeltaText: selectedValue(value.toolOutputDeltaText, "tool_output_delta_text"),
      toolOutputText: selectedValue(value.toolOutputText, "tool_output_text"),
      toolParentMessageId: selectedValue(value.toolParentMessageId, "tool_parent_message_id"),
      toolResultMessageId: selectedValue(value.toolResultMessageId, "tool_result_message_id"),
      toolStatus: selectedValue(value.toolStatus, "tool_status"),
      tokens: selectedValue(value.tokens, "tokens"),
      traceId: selectedValue(value.traceId, "trace_id"),
      visibility: selectedValue(value.visibility, "visibility"),
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.id, value.sessionId),
        isNull(sessionsTable.archivedAt),
        requiredCursor === null
          ? undefined
          : eq(sessionsTable.runtimeEventSeqCursor, requiredCursor),
        driverFence === undefined
          ? undefined
          : and(
              exists(
                database
                  .select({ id: driverInstancesTable.id })
                  .from(driverInstancesTable)
                  .where(
                    and(
                      eq(driverInstancesTable.id, driverFence.driverInstanceId),
                      eq(driverInstancesTable.connectionId, driverFence.connectionId),
                      eq(driverInstancesTable.generation, driverFence.generation),
                      eq(driverInstancesTable.sandboxSessionId, value.sessionId),
                    ),
                  ),
              ),
              driverFence.sessionRunId === null
                ? undefined
                : and(
                    eq(sessionsTable.lastRunId, driverFence.sessionRunId),
                    eq(sessionsTable.status, "RUNNING"),
                    isNull(sessionsTable.statusOperationId),
                    exists(
                      database
                        .select({ id: sessionRunsTable.id })
                        .from(sessionRunsTable)
                        .where(
                          and(
                            eq(sessionRunsTable.id, driverFence.sessionRunId),
                            eq(sessionRunsTable.sessionId, value.sessionId),
                            eq(sessionRunsTable.driverInstanceId, driverFence.driverInstanceId),
                            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
                          ),
                        ),
                    ),
                  ),
            ),
        value.runId === null
          ? undefined
          : exists(
              database
                .select({ id: sessionRunsTable.id })
                .from(sessionRunsTable)
                .where(
                  and(
                    eq(sessionRunsTable.id, value.runId),
                    eq(sessionRunsTable.sessionId, value.sessionId),
                    inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
                  ),
                ),
            ),
      ),
    )
    .$dynamic();
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
    allowTerminatedSession: boolean;
    driverFence?: DriverRuntimeEventFence;
    rows: ProjectedSessionRuntimeEventRowInput[];
    sessionId: SessionId;
    timestampMs: number;
  },
): Promise<InsertSessionEventResult> {
  return insertSessionEventRows(
    database,
    toSessionRuntimeEventInsertValues(input),
    new Map([
      [
        input.sessionId,
        {
          allowTerminatedSession: input.allowTerminatedSession,
          ...(input.driverFence === undefined ? {} : { driverFence: input.driverFence }),
          previousCursor: input.allocation.previousCursor,
        },
      ],
    ]),
  );
}

async function filterNewSessionRuntimeEventInputs(
  database: D1Database,
  input: PersistSessionRuntimeEventsInput,
): Promise<(SessionRuntimeEventInput & { semanticHash: string })[]> {
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
  const acceptedHashes = new Map<string, string>();
  const records = await Promise.all(
    input.records.map(async (record) => ({
      ...record,
      semanticHash: await createRuntimeEventSemanticHash(record.event),
    })),
  );

  return records.filter((record) => {
    const sourceEventId = readSessionRuntimeEventSourceEventId({
      event: record.event,
      sourceEventId: record.sourceEventId,
    });
    const receipt = persistedReceipts.get(sourceEventId);
    const acceptedHash = acceptedHashes.get(sourceEventId);

    if (
      (receipt !== undefined && receipt.semanticHash !== record.semanticHash) ||
      (acceptedHash !== undefined && acceptedHash !== record.semanticHash)
    ) {
      throw new Error(`Runtime event source ${sourceEventId} conflicts with its durable receipt.`);
    }

    if (receipt !== undefined || acceptedHash !== undefined) {
      return false;
    }

    acceptedHashes.set(sourceEventId, record.semanticHash);
    return true;
  });
}

export async function persistSessionRuntimeEvents(
  database: D1Database,
  input: PersistSessionRuntimeEventsInput,
): Promise<PersistSessionRuntimeEventsResult> {
  assertRuntimeEventBatchSessionMatches(input);
  assertNoRunTerminalEvents(input.records);
  if (
    input.driverFence !== undefined &&
    input.records.some(
      (record) =>
        record.event.runId !== undefined && record.event.runId !== input.driverFence?.sessionRunId,
    )
  ) {
    throw new Error("Driver runtime event does not match its fenced Session Run.");
  }
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

  const rows = await Promise.all(
    records.map(async (record) => ({
      artifactAttemptId: record.artifactAttemptId ?? null,
      artifactManifestJson: record.artifactManifestJson ?? null,
      artifactManifestSha256: record.artifactManifestSha256 ?? null,
      event: record.event,
      occurredAt: record.occurredAt,
      provenMcpCommandId: record.provenMcpCommandId ?? null,
      semanticHash: record.semanticHash,
      sourceEventId: readSessionRuntimeEventSourceEventId({
        event: record.event,
        sourceEventId: record.sourceEventId,
      }),
    })),
  );
  const result = await persistSessionRuntimeEventRows(database, {
    allowTerminatedSession: canWriteAfterTerminatedSession(records),
    ...(input.driverFence === undefined ? {} : { driverFence: input.driverFence }),
    rows,
    sessionId: input.sessionId,
  });
  const insertedSourceEventIds = new Set(result.insertedSourceEventIds);

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
      semantic_hash: sessionEventsTable.semanticHash,
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
      semanticHash: row.semantic_hash,
      seq: row.seq,
      type: row.type,
    });
  }

  return receipts;
}
