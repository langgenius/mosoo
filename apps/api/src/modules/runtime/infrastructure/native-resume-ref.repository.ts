import type {
  DriverNativeRuntimeRef,
  DriverRuntime,
  NativeCheckpoint,
} from "@mosoo/agent-driver/runtime";
import { parseDriverNativeRuntimeRef, parseNativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { nativeResumeRefsTable, sandboxBackupsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, isNotNull, notExists, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import type { AppDatabase } from "../../../platform/db/drizzle";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface NativeResumeRefObservation {
  driverInstanceId: DriverInstanceId;
  nativeResumeRef: DriverNativeRuntimeRef;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}

export type NativeContinuationState =
  | { status: "first-use" }
  | { status: "committed"; checkpoint: NativeCheckpoint }
  | { status: "invalidated"; sourceEventId: string | null };

export function noNativeCheckpointInvalidation(db: AppDatabase, sessionId: SessionId | SQLWrapper) {
  return notExists(
    db
      .select({ sessionId: nativeResumeRefsTable.sessionId })
      .from(nativeResumeRefsTable)
      .where(
        and(
          eq(nativeResumeRefsTable.sessionId, sessionId),
          isNotNull(nativeResumeRefsTable.invalidatedAt),
        ),
      ),
  );
}

export async function getNativeContinuationForRuntime(
  database: D1Database,
  input: { runtimeId: DriverRuntime; sessionId: SessionId },
): Promise<NativeContinuationState> {
  const row = await getAppDatabase(database)
    .select()
    .from(nativeResumeRefsTable)
    .where(eq(nativeResumeRefsTable.sessionId, input.sessionId))
    .get();
  if (row === undefined) return { status: "first-use" };
  if (row.runtimeId !== input.runtimeId) {
    throw new Error("Native continuation belongs to a different runtime.");
  }
  if (row.invalidatedAt !== null) {
    return { status: "invalidated", sourceEventId: row.invalidatedSourceEventId };
  }
  if (row.committedSessionRunId === null && row.committedValue === null) {
    return { status: "first-use" };
  }
  if (row.committedFormatVersion !== 1) {
    throw new Error("Legacy native continuation requires a verified checkpoint migration.");
  }
  return {
    status: "committed",
    checkpoint: parseNativeCheckpoint({
      formatVersion: row.committedFormatVersion,
      nativeRef: parseDriverNativeRuntimeRef({
        kind: row.kind,
        runtimeId: row.runtimeId,
        value: row.committedValue,
      }),
      runId: row.committedSessionRunId,
    }),
  };
}

export async function getCommittedNativeCheckpointBackup(
  database: D1Database,
  checkpoint: NativeCheckpoint,
): Promise<string> {
  const backup = await getAppDatabase(database)
    .select({ id: sandboxBackupsTable.id })
    .from(sandboxBackupsTable)
    .where(
      and(
        eq(
          sandboxBackupsTable.sessionRunId,
          parsePlatformId<SessionRunId>(checkpoint.runId, "checkpoint Run"),
        ),
        eq(sandboxBackupsTable.status, "ready"),
      ),
    )
    .orderBy(desc(sandboxBackupsTable.createdAt))
    .limit(1)
    .get();
  if (backup === undefined) throw new Error("Committed native checkpoint has no ready backup.");
  return backup.id;
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
