import { nativeResumeRefsTable, sandboxBackupsTable, sessionRunsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { SandboxBackupId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";
import { shouldBackupSandboxSession } from "../../../sessions/domain/session-lifecycle";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
import type { RuntimeSessionLink } from "../driver-instance/event-types";
import { RuntimeSubjectCheckpointFailedError } from "../runtime-subject-lifecycle/runtime-subject-errors";
import { SANDBOX_BACKUP_TTL_SECONDS } from "../sandbox-backup-config";
import { createRuntimeSandboxBackup, deleteSandboxBackupObjects } from "../sandbox-backup-platform";
import { listSandboxSessionBackupCandidates } from "../sandbox-backup-store";

type NativeResumeSnapshot = Pick<
  typeof nativeResumeRefsTable.$inferSelect,
  | "kind"
  | "runtimeId"
  | "value"
  | "observedSessionRunId"
  | "committedSessionRunId"
  | "committedValue"
>;

export interface SessionRunCompletionCheckpoint {
  backupId: SandboxBackupId;
  dir: string;
  nativeResume: NativeResumeSnapshot;
  sandboxId: SandboxId;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
}

// Creating an object does not make it a continuation boundary. The Run writer
// records it and its captured native cursor atomically with successful completion.
export async function prepareSessionRunCompletionCheckpoint(
  bindings: ApiBindings,
  link: RuntimeSessionLink,
): Promise<SessionRunCompletionCheckpoint | undefined> {
  if (link.sandboxKind !== "cattle") {
    return undefined;
  }
  if (link.sandboxId === null || link.sessionId === null || link.sessionRunId === null) {
    throw new Error("Session completion requires a linked workspace.");
  }
  const db = getAppDatabase(bindings.DB);
  const run = await db
    .select({ status: sessionRunsTable.status, runtimeId: sessionRunsTable.runtimeId })
    .from(sessionRunsTable)
    .where(eq(sessionRunsTable.id, link.sessionRunId))
    .get();
  if (run !== undefined && isTerminalSessionRunStatus(run.status)) {
    return undefined;
  }

  try {
    const targets = await listSandboxSessionBackupCandidates(bindings.DB, link.sandboxId);
    const target = targets.find((candidate) => candidate.sessionId === link.sessionId);
    if (target === undefined || !shouldBackupSandboxSession(target)) {
      throw new Error("Session completion has no eligible workspace checkpoint target.");
    }
    const nativeResume =
      (await getAppDatabase(bindings.DB)
        .select({
          committedSessionRunId: nativeResumeRefsTable.committedSessionRunId,
          committedValue: nativeResumeRefsTable.committedValue,
          kind: nativeResumeRefsTable.kind,
          observedSessionRunId: nativeResumeRefsTable.observedSessionRunId,
          runtimeId: nativeResumeRefsTable.runtimeId,
          value: nativeResumeRefsTable.value,
        })
        .from(nativeResumeRefsTable)
        .where(eq(nativeResumeRefsTable.sessionId, link.sessionId))
        .get()) ?? null;
    if (
      nativeResume === null ||
      nativeResume.value.trim().length === 0 ||
      nativeResume.runtimeId !== run?.runtimeId ||
      (nativeResume.observedSessionRunId !== link.sessionRunId &&
        (nativeResume.committedSessionRunId === null ||
          nativeResume.value !== nativeResume.committedValue))
    ) {
      throw new Error(
        "Session completion requires a valid native resume cursor for this runtime and turn.",
      );
    }
    const backup = await createRuntimeSandboxBackup(bindings, {
      dir: target.cwd,
      sandboxId: link.sandboxId,
      sessionId: link.sessionId,
      ttlSeconds: SANDBOX_BACKUP_TTL_SECONDS,
    });
    return {
      backupId: parsePlatformId<SandboxBackupId>(backup.id, "completion checkpoint id"),
      dir: backup.dir,
      nativeResume,
      sandboxId: link.sandboxId,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
    };
  } catch (cause) {
    throw new RuntimeSubjectCheckpointFailedError({ cause, runtimeSubjectId: link.sandboxId });
  }
}

export function completionCheckpointSnapshotCondition(
  db: AppDatabase,
  checkpoint: SessionRunCompletionCheckpoint,
) {
  const snapshot = checkpoint.nativeResume;
  const query = db
    .select({ sessionId: nativeResumeRefsTable.sessionId })
    .from(nativeResumeRefsTable);
  return exists(
    query.where(
      and(
        eq(nativeResumeRefsTable.sessionId, checkpoint.sessionId),
        eq(nativeResumeRefsTable.kind, snapshot.kind),
        eq(nativeResumeRefsTable.runtimeId, snapshot.runtimeId),
        eq(nativeResumeRefsTable.value, snapshot.value),
        snapshot.observedSessionRunId === null
          ? isNull(nativeResumeRefsTable.observedSessionRunId)
          : eq(nativeResumeRefsTable.observedSessionRunId, snapshot.observedSessionRunId),
        snapshot.committedSessionRunId === null
          ? isNull(nativeResumeRefsTable.committedSessionRunId)
          : eq(nativeResumeRefsTable.committedSessionRunId, snapshot.committedSessionRunId),
        snapshot.committedValue === null
          ? isNull(nativeResumeRefsTable.committedValue)
          : eq(nativeResumeRefsTable.committedValue, snapshot.committedValue),
      ),
    ),
  );
}

export async function discardUncommittedCompletionCheckpoint(
  bindings: ApiBindings,
  checkpoint: SessionRunCompletionCheckpoint | undefined,
): Promise<void> {
  if (checkpoint === undefined) {
    return;
  }
  try {
    const recorded = await getAppDatabase(bindings.DB)
      .select({ id: sandboxBackupsTable.id })
      .from(sandboxBackupsTable)
      .where(eq(sandboxBackupsTable.id, checkpoint.backupId))
      .get();
    if (recorded === undefined) {
      await deleteSandboxBackupObjects(bindings, [checkpoint.backupId]);
    }
  } catch {
    // An ambiguous D1 result must never delete an object backing a committed
    // boundary. Cleanup failure also must not turn a committed success into error.
    logWarn("runtime.session_completion.checkpoint_cleanup_failed", {
      backupId: checkpoint.backupId,
      sandboxId: checkpoint.sandboxId,
      sessionRunId: checkpoint.sessionRunId,
    });
  }
}

export function completionCheckpointRecordedCondition(
  db: AppDatabase,
  checkpoint: SessionRunCompletionCheckpoint,
) {
  return exists(
    db
      .select({ id: sandboxBackupsTable.id })
      .from(sandboxBackupsTable)
      .where(
        and(
          eq(sandboxBackupsTable.id, checkpoint.backupId),
          eq(sandboxBackupsTable.sessionRunId, checkpoint.sessionRunId),
          eq(sandboxBackupsTable.status, "ready"),
        ),
      ),
  );
}

export function completionCheckpointWrites(
  db: AppDatabase,
  checkpoint: SessionRunCompletionCheckpoint,
  timestampMs: number,
) {
  // This INSERT must immediately follow the guarded Run UPDATE in the same
  // D1 batch: a lost completion race must not publish a backup or native cursor.
  const insert = db.insert(sandboxBackupsTable).select(
    db
      .select({
        createdAt: sql<number>`${timestampMs}`.as("created_at"),
        dir: sql<string>`${checkpoint.dir}`.as("dir"),
        errorMessage: sql<null>`null`.as("error_message"),
        id: sql<SandboxBackupId>`${checkpoint.backupId}`.as("id"),
        keep: sql<boolean>`0`.as("keep"),
        sandboxId: sql<SandboxId>`${checkpoint.sandboxId}`.as("sandbox_id"),
        sessionRunId: sql<SessionRunId>`${checkpoint.sessionRunId}`.as("session_run_id"),
        status: sql<"ready">`'ready'`.as("status"),
        ttlSeconds: sql<number>`${SANDBOX_BACKUP_TTL_SECONDS}`.as("ttl_seconds"),
        updatedAt: sql<number>`${timestampMs}`.as("updated_at"),
      })
      .from(sessionRunsTable)
      .where(and(eq(sessionRunsTable.id, checkpoint.sessionRunId), sql`changes() = 1`)),
  );
  return [
    insert,
    db
      .update(nativeResumeRefsTable)
      .set({
        committedSessionRunId: checkpoint.sessionRunId,
        committedValue: checkpoint.nativeResume.value,
      })
      .where(
        and(
          eq(nativeResumeRefsTable.sessionId, checkpoint.sessionId),
          completionCheckpointRecordedCondition(db, checkpoint),
        ),
      ),
  ];
}
