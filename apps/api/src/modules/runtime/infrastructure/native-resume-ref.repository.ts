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
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

interface NativeResumeRefRow {
  committed_value: string | null;
  kind: string;
  runtime_id: string;
  session_kind: string;
  value: string;
}

export interface NativeResumeRefObservation {
  driverInstanceId: DriverInstanceId;
  nativeResumeRef: DriverNativeRuntimeRef;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
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

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(nativeResumeRefsTable)
    .values({
      createdAt: timestampMs,
      kind: observation.nativeResumeRef.kind,
      observedDriverInstanceId: observation.driverInstanceId,
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
        observedSessionRunId: sql`excluded.observed_session_run_id`,
        runtimeId: sql`excluded.runtime_id`,
        updatedAt: sql`excluded.updated_at`,
        value: sql`excluded.value`,
      },
      target: nativeResumeRefsTable.sessionId,
    })
    .run();
}
