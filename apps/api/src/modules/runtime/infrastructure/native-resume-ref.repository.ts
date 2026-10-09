import type { DriverNativeRuntimeRef, DriverRuntime } from "@mosoo/agent-driver/runtime";
import { parseDriverNativeRuntimeRef } from "@mosoo/agent-driver/runtime";
import { nativeResumeRefsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface NativeResumeRefObservation {
  driverInstanceId: DriverInstanceId;
  nativeResumeRef: DriverNativeRuntimeRef;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
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
        committedValue: nativeResumeRefsTable.committedValue,
        kind: nativeResumeRefsTable.kind,
        runtimeId: nativeResumeRefsTable.runtimeId,
      })
      .from(nativeResumeRefsTable)
      .where(eq(nativeResumeRefsTable.sessionId, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (row === null || row.committedValue === null) {
    return null;
  }

  const ref = parseDriverNativeRuntimeRef({
    kind: row.kind,
    runtimeId: row.runtimeId,
    value: row.committedValue,
  });

  return ref.runtimeId === input.runtimeId ? ref : null;
}

export async function upsertNativeResumeRef(
  database: D1Database,
  observation: NativeResumeRefObservation,
): Promise<void> {
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
