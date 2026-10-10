import { nativeRuntimeRefsEqual, parseNativeCheckpoint } from "@mosoo/agent-driver/runtime";
import type { NativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { nativeResumeRefsTable, sandboxBackupsTable, sessionRunsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { SandboxBackupId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { ORPCError } from "@orpc/server";
import { and, eq, exists, isNull, sql } from "drizzle-orm";

import { logWarn } from "../../../../platform/cloudflare/logger";
import { withDisposedRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";
import { shouldBackupSandboxSession } from "../../../sessions/domain/session-lifecycle";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";
import type { RuntimeSessionLink } from "../driver-instance/event-types";
import { terminalConflict } from "../driver-instance/terminal-conflict";
import { verifyNativeCheckpointBundle } from "../native-checkpoint-bundle";
import { RuntimeSubjectCheckpointFailedError } from "../runtime-subject-lifecycle/runtime-subject-errors";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-platform";
import { SANDBOX_BACKUP_TTL_SECONDS } from "../sandbox-backup-config";
import { createRuntimeSandboxBackup, deleteSandboxBackupObjects } from "../sandbox-backup-platform";
import { listSandboxSessionBackupCandidates } from "../sandbox-backup-store";

type NativeResumeSnapshot = Pick<
  typeof nativeResumeRefsTable.$inferSelect,
  | "committedFormatVersion"
  | "invalidatedAt"
  | "invalidatedSourceEventId"
  | "kind"
  | "runtimeId"
  | "value"
  | "observedSessionRunId"
  | "committedSessionRunId"
  | "committedValue"
>;

export interface SessionRunCompletionCheckpoint {
  backupId: SandboxBackupId;
  descriptor: NativeCheckpoint;
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
  descriptor: NativeCheckpoint,
): Promise<SessionRunCompletionCheckpoint | undefined> {
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
    const checkpoint = parseNativeCheckpoint(descriptor);
    if (
      run === undefined ||
      parsePlatformId<SessionRunId>(checkpoint.runId, "checkpoint Run") !== link.sessionRunId ||
      checkpoint.nativeRef.runtimeId !== run.runtimeId
    ) {
      throw terminalConflict({
        currentStatus: run?.status ?? null,
        runId: link.sessionRunId,
        reason: "Native checkpoint does not belong to this Run and runtime.",
      });
    }
    const targets = await listSandboxSessionBackupCandidates(bindings.DB, link.sandboxId);
    const target = targets.find((candidate) => candidate.sessionId === link.sessionId);
    if (target === undefined || !shouldBackupSandboxSession(target)) {
      throw new Error("Session completion has no eligible workspace checkpoint target.");
    }
    const nativeResume =
      (await getAppDatabase(bindings.DB)
        .select({
          committedFormatVersion: nativeResumeRefsTable.committedFormatVersion,
          invalidatedAt: nativeResumeRefsTable.invalidatedAt,
          invalidatedSourceEventId: nativeResumeRefsTable.invalidatedSourceEventId,
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
      nativeResume.observedSessionRunId !== link.sessionRunId ||
      !nativeRuntimeRefsEqual(checkpoint.nativeRef, {
        kind: nativeResume.kind,
        runtimeId: nativeResume.runtimeId,
        value: nativeResume.value,
      })
    ) {
      throw terminalConflict({
        currentStatus: run.status,
        runId: link.sessionRunId,
        reason: "Session completion requires this Run's observed native resume cursor.",
      });
    }
    await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(bindings, link.sandboxId),
      (sandbox) => verifyNativeCheckpointBundle(sandbox, { checkpoint, cwd: target.cwd }),
    );
    const backup = await createRuntimeSandboxBackup(bindings, {
      dir: target.cwd,
      sandboxId: link.sandboxId,
      sessionId: link.sessionId,
      ttlSeconds: SANDBOX_BACKUP_TTL_SECONDS,
    });
    return {
      backupId: parsePlatformId<SandboxBackupId>(backup.id, "completion checkpoint id"),
      descriptor: checkpoint,
      dir: backup.dir,
      nativeResume,
      sandboxId: link.sandboxId,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
    };
  } catch (cause) {
    if (cause instanceof ORPCError && cause.code === "terminal_conflict") throw cause;
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
        snapshot.committedFormatVersion === null
          ? isNull(nativeResumeRefsTable.committedFormatVersion)
          : eq(nativeResumeRefsTable.committedFormatVersion, snapshot.committedFormatVersion),
        snapshot.invalidatedAt === null
          ? isNull(nativeResumeRefsTable.invalidatedAt)
          : eq(nativeResumeRefsTable.invalidatedAt, snapshot.invalidatedAt),
        snapshot.invalidatedSourceEventId === null
          ? isNull(nativeResumeRefsTable.invalidatedSourceEventId)
          : eq(nativeResumeRefsTable.invalidatedSourceEventId, snapshot.invalidatedSourceEventId),
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
        committedFormatVersion: checkpoint.descriptor.formatVersion,
        committedSessionRunId: checkpoint.sessionRunId,
        invalidatedAt: null,
        invalidatedSourceEventId: null,
        committedValue: checkpoint.nativeResume.value,
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(nativeResumeRefsTable.sessionId, checkpoint.sessionId),
          completionCheckpointRecordedCondition(db, checkpoint),
        ),
      ),
  ];
}
