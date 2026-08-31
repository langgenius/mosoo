import type {
  DriverNativeRuntimeRef,
  DriverNativeRuntimeRefKind,
  DriverRuntime,
} from "@mosoo/agent-driver/runtime";
import {
  getExpectedDriverNativeRuntimeRefKind,
  parseDriverNativeRuntimeRef,
} from "@mosoo/agent-driver/runtime";
import { nativeResumeRefsTable, sessionsTable } from "@mosoo/db";
import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { RUNTIME_KIND_POLICIES } from "../domain/runtime-kind-policy";

interface NativeResumeRefRow {
  committed_value: string | null;
  kind: string;
  runtime_id: string;
  session_kind: string;
  value: string;
}

interface ObservedNativeResumeRefRow {
  kind: string;
  observed_driver_instance_id: string | null;
  observed_event_seq: number;
  observed_session_run_id: string | null;
  runtime_id: string;
  value: string;
}

export interface NativeResumeRefObservation {
  driverInstanceId: DriverInstanceId;
  nativeResumeRef: DriverNativeRuntimeRef;
  observedEventSeq: number;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}

const PLATFORM_NATIVE_RESUME_KINDS = Object.values(RUNTIME_KIND_POLICIES)
  .filter((policy) => policy.nativeResume.persistence === "platform")
  .map((policy) => policy.kind);

export function prepareNativeResumeRefProjection(
  database: D1Database,
  input: NativeResumeRefObservation & {
    createdAt: number;
    eventId: RuntimeEventId;
    semanticHash: string;
  },
): D1PreparedStatement[] {
  enforceNativeRuntimeRefShape(input.nativeResumeRef);

  if (!Number.isSafeInteger(input.observedEventSeq) || input.observedEventSeq < 0) {
    throw new Error("Native resume ref event seq must be a non-negative safe integer.");
  }

  const platformKinds = PLATFORM_NATIVE_RESUME_KINDS.map(() => "?").join(", ");
  const eligibleReceipt = `EXISTS (
    SELECT 1
      FROM session_event AS receipt
      JOIN session_run AS run
        ON run.id = ?
       AND run.session_id = receipt.session_id
       AND run.driver_instance_id = ?
      JOIN driver_instance AS driver
        ON driver.id = ?
       AND driver.sandbox_session_id = receipt.session_id
      JOIN sandbox AS runtime_sandbox
        ON runtime_sandbox.id = driver.sandbox_id
       AND runtime_sandbox.kind IN (${platformKinds})
     WHERE receipt.id = ?
       AND receipt.session_id = ?
       AND receipt.event_type = 'runtime.resume.updated'
       AND receipt.run_id = ?
       AND receipt.semantic_hash = ?
       AND receipt.seq = ?
  )`;
  const eligibilityBindings = [
    input.sessionRunId,
    input.driverInstanceId,
    input.driverInstanceId,
    ...PLATFORM_NATIVE_RESUME_KINDS,
    input.eventId,
    input.sessionId,
    input.sessionRunId,
    input.semanticHash,
    input.observedEventSeq,
  ];
  const upsert = database
    .prepare(
      `INSERT INTO native_resume_ref (
         created_at, kind, observed_driver_instance_id, observed_event_seq,
         observed_session_run_id, runtime_id, session_id, updated_at, value
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${eligibleReceipt}
       ON CONFLICT (session_id) DO UPDATE SET
         kind = excluded.kind,
         observed_driver_instance_id = excluded.observed_driver_instance_id,
         observed_event_seq = excluded.observed_event_seq,
         observed_session_run_id = excluded.observed_session_run_id,
         runtime_id = excluded.runtime_id,
         updated_at = excluded.updated_at,
         value = excluded.value
       WHERE native_resume_ref.observed_event_seq < excluded.observed_event_seq`,
    )
    .bind(
      input.createdAt,
      input.nativeResumeRef.kind,
      input.driverInstanceId,
      input.observedEventSeq,
      input.sessionRunId,
      input.nativeResumeRef.runtimeId,
      input.sessionId,
      input.createdAt,
      input.nativeResumeRef.value,
      ...eligibilityBindings,
    );
  const guard = database
    .prepare(
      `INSERT INTO session_event (id)
       SELECT ?
        WHERE ${eligibleReceipt}
          AND NOT EXISTS (
            SELECT 1
              FROM native_resume_ref AS stored
             WHERE stored.session_id = ?
               AND (
                 stored.observed_event_seq > ?
                 OR (
                   stored.observed_event_seq = ?
                   AND stored.kind = ?
                   AND stored.observed_driver_instance_id = ?
                   AND stored.observed_session_run_id = ?
                   AND stored.runtime_id = ?
                   AND stored.value = ?
                 )
               )
          )`,
    )
    .bind(
      input.eventId,
      ...eligibilityBindings,
      input.sessionId,
      input.observedEventSeq,
      input.observedEventSeq,
      input.nativeResumeRef.kind,
      input.driverInstanceId,
      input.sessionRunId,
      input.nativeResumeRef.runtimeId,
      input.nativeResumeRef.value,
    );

  return [upsert, guard];
}

function expectedNativeRuntimeRefKind(
  runtimeId: DriverNativeRuntimeRef["runtimeId"],
): DriverNativeRuntimeRefKind {
  return getExpectedDriverNativeRuntimeRefKind(runtimeId);
}

function enforceNativeRuntimeRefShape(ref: DriverNativeRuntimeRef): void {
  const expectedKind = expectedNativeRuntimeRefKind(ref.runtimeId);

  if (ref.kind !== expectedKind) {
    throw new Error(`Native resume ref kind ${ref.kind} does not match runtime ${ref.runtimeId}.`);
  }
}

function toNativeRuntimeRef(row: NativeResumeRefRow): DriverNativeRuntimeRef | null {
  const value = row.session_kind === "cattle" ? row.committed_value : row.value;

  if (value === null) {
    return null;
  }

  const ref = parseDriverNativeRuntimeRef({
    kind: row.kind,
    runtimeId: row.runtime_id,
    value,
  });

  enforceNativeRuntimeRefShape(ref);
  return ref;
}

export async function getNativeResumeRefForRuntime(
  database: D1Database,
  input: {
    runtimeId: DriverRuntime;
    sessionId: SessionId;
  },
): Promise<DriverNativeRuntimeRef | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        committed_value: nativeResumeRefsTable.committedValue,
        kind: nativeResumeRefsTable.kind,
        runtime_id: nativeResumeRefsTable.runtimeId,
        session_kind: sessionsTable.kind,
        value: nativeResumeRefsTable.value,
      })
      .from(nativeResumeRefsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, nativeResumeRefsTable.sessionId))
      .where(eq(nativeResumeRefsTable.sessionId, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const ref = toNativeRuntimeRef(row);

  return ref?.runtimeId === input.runtimeId ? ref : null;
}

export async function deleteNativeResumeRefsForSessions(
  database: D1Database,
  sessionIds: readonly SessionId[],
): Promise<void> {
  const uniqueSessionIds = [...new Set(sessionIds)];

  if (uniqueSessionIds.length === 0) {
    return;
  }

  await getAppDatabase(database)
    .delete(nativeResumeRefsTable)
    .where(inArray(nativeResumeRefsTable.sessionId, uniqueSessionIds))
    .run();
}

export async function upsertNativeResumeRef(
  database: D1Database,
  observation: NativeResumeRefObservation,
): Promise<void> {
  enforceNativeRuntimeRefShape(observation.nativeResumeRef);

  if (!Number.isSafeInteger(observation.observedEventSeq) || observation.observedEventSeq < 0) {
    throw new Error("Native resume ref event seq must be a non-negative safe integer.");
  }

  const timestampMs = currentTimestampMs();
  const appDatabase = getAppDatabase(database);

  await appDatabase
    .insert(nativeResumeRefsTable)
    .values({
      createdAt: timestampMs,
      kind: observation.nativeResumeRef.kind,
      observedDriverInstanceId: observation.driverInstanceId,
      observedEventSeq: observation.observedEventSeq,
      observedSessionRunId: observation.sessionRunId,
      runtimeId: observation.nativeResumeRef.runtimeId,
      sessionId: observation.sessionId,
      updatedAt: timestampMs,
      value: observation.nativeResumeRef.value,
    })
    .onConflictDoUpdate({
      set: {
        kind: sql`excluded.kind`,
        observedDriverInstanceId: sql`excluded.observed_driver_instance_id`,
        observedEventSeq: sql`excluded.observed_event_seq`,
        observedSessionRunId: sql`excluded.observed_session_run_id`,
        runtimeId: sql`excluded.runtime_id`,
        updatedAt: sql`excluded.updated_at`,
        value: sql`excluded.value`,
      },
      setWhere: sql`${nativeResumeRefsTable.observedEventSeq} < excluded.observed_event_seq`,
      target: nativeResumeRefsTable.sessionId,
    })
    .run();

  const stored =
    (await appDatabase
      .select({
        kind: nativeResumeRefsTable.kind,
        observed_driver_instance_id: nativeResumeRefsTable.observedDriverInstanceId,
        observed_event_seq: nativeResumeRefsTable.observedEventSeq,
        observed_session_run_id: nativeResumeRefsTable.observedSessionRunId,
        runtime_id: nativeResumeRefsTable.runtimeId,
        value: nativeResumeRefsTable.value,
      })
      .from(nativeResumeRefsTable)
      .where(eq(nativeResumeRefsTable.sessionId, observation.sessionId))
      .limit(1)
      .get()) ?? null;

  assertNativeResumeRefConverged(stored, observation);
}

function assertNativeResumeRefConverged(
  stored: ObservedNativeResumeRefRow | null,
  observation: NativeResumeRefObservation,
): void {
  if (stored === null || stored.observed_event_seq < observation.observedEventSeq) {
    throw new Error("Native resume ref CAS did not persist the durable event.");
  }

  if (stored.observed_event_seq > observation.observedEventSeq) {
    return;
  }

  if (
    stored.kind !== observation.nativeResumeRef.kind ||
    stored.observed_driver_instance_id !== observation.driverInstanceId ||
    stored.observed_session_run_id !== observation.sessionRunId ||
    stored.runtime_id !== observation.nativeResumeRef.runtimeId ||
    stored.value !== observation.nativeResumeRef.value
  ) {
    throw new Error("Native resume ref event seq was replayed with conflicting content.");
  }
}
