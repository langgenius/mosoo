import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { shouldBackupSandboxSession } from "../../sessions/domain/session-lifecycle";
import type { RuntimeCheckpointRule } from "../domain/runtime-kind-policy";
import { RuntimeSubjectCheckpointFailedError } from "./runtime-subject-lifecycle/runtime-subject-errors";
import { createRuntimeSandboxBackup, deleteSandboxBackupObjects } from "./sandbox-backup-platform";
import { selectSandboxBackupPruneIds } from "./sandbox-backup-pruning";
import type { CreatedSandboxBackupWrite } from "./sandbox-backup-store";
import {
  deleteSandboxBackupRecordsForDir,
  listReadySandboxBackupsForSessionRun,
  listReadySandboxBackupsForPruning,
  listSandboxBackupIdsByDir,
  listSandboxSessionBackupCandidates,
  markSandboxBackupsPruned,
  recordCreatedSandboxBackups,
} from "./sandbox-backup-store";

const BACKUP_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface SandboxSessionBackupTarget {
  cwd: string;
  sessionId: string;
}

interface SandboxCheckpointBackupTarget {
  readonly dir: string;
  readonly sessionId: string | null;
  readonly updateSandboxLastBackup: boolean;
}

async function pruneSandboxBackups(bindings: ApiBindings, sandboxId: string): Promise<void> {
  const backups = await listReadySandboxBackupsForPruning(bindings.DB, sandboxId);
  const pruneIds = selectSandboxBackupPruneIds(backups);

  await deleteSandboxBackupObjects(bindings, pruneIds);
  await markSandboxBackupsPruned(bindings.DB, pruneIds);
}

async function listSandboxSessionBackupTargets(
  database: D1Database,
  sandboxId: string,
): Promise<SandboxSessionBackupTarget[]> {
  const candidates = await listSandboxSessionBackupCandidates(database, sandboxId);

  return candidates
    .filter((candidate) =>
      shouldBackupSandboxSession({
        lastMessageAt: candidate.lastMessageAt,
        sessionStatus: candidate.sessionStatus,
      }),
    )
    .map((candidate) => ({
      cwd: candidate.cwd,
      sessionId: candidate.sessionId,
    }));
}

async function listSandboxCheckpointBackupTargets(
  database: D1Database,
  input: {
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
  },
): Promise<SandboxCheckpointBackupTarget[]> {
  const targets: SandboxCheckpointBackupTarget[] = [];
  let sessionTargets: SandboxSessionBackupTarget[] | null = null;

  for (const rule of input.rules) {
    switch (rule.type) {
      case "subject_memory": {
        targets.push({
          dir: rule.path,
          sessionId: null,
          updateSandboxLastBackup: rule.updateSubjectCheckpoint,
        });
        break;
      }
      case "session_workspaces": {
        sessionTargets ??= await listSandboxSessionBackupTargets(database, input.sandboxId);
        targets.push(
          ...sessionTargets.map((target) => ({
            dir: target.cwd,
            sessionId: rule.sanitizeTransientState ? target.sessionId : null,
            updateSandboxLastBackup: false,
          })),
        );
        break;
      }
    }
  }

  return targets;
}

async function createSandboxBackupsForTargets(
  bindings: ApiBindings,
  input: {
    readonly sandboxId: string;
    readonly targets: readonly SandboxCheckpointBackupTarget[];
  },
): Promise<CreatedSandboxBackupWrite[]> {
  const results = await Promise.allSettled(
    input.targets.map(async (target) => ({
      backup: await createRuntimeSandboxBackup(bindings, {
        dir: target.dir,
        sandboxId: input.sandboxId,
        sessionId: target.sessionId,
        ttlSeconds: BACKUP_TTL_SECONDS,
      }).catch((error: unknown) => {
        throw new RuntimeSubjectCheckpointFailedError({
          cause: error,
          dir: target.dir,
          runtimeSubjectId: input.sandboxId,
        });
      }),
      updateSandboxLastBackup: target.updateSandboxLastBackup,
    })),
  );
  const createdBackups = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedBackup = results.find((result) => result.status === "rejected");

  if (failedBackup?.status === "rejected") {
    await deleteSandboxBackupObjects(
      bindings,
      createdBackups.map((entry) => entry.backup.id),
    );
    throw failedBackup.reason;
  }

  return createdBackups;
}

async function recordCreatedCheckpointBackups(
  bindings: ApiBindings,
  input: {
    readonly backups: readonly CreatedSandboxBackupWrite[];
    readonly checkpointSessionId?: string;
    readonly operationId?: string | null;
    readonly sandboxId: string;
    readonly sessionRunId?: string;
  },
): Promise<void> {
  try {
    await recordCreatedSandboxBackups(bindings.DB, {
      backups: input.backups,
      ...(input.checkpointSessionId === undefined
        ? {}
        : { checkpointSessionId: input.checkpointSessionId }),
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      sandboxId: input.sandboxId,
      ...(input.sessionRunId === undefined ? {} : { sessionRunId: input.sessionRunId }),
      ttlSeconds: BACKUP_TTL_SECONDS,
    });
  } catch (error) {
    if (input.sessionRunId !== undefined) {
      let recordedBackups: readonly CreatedSandboxBackupWrite["backup"][];

      try {
        recordedBackups = await listReadySandboxBackupsForSessionRun(bindings.DB, {
          sandboxId: input.sandboxId,
          sessionRunId: input.sessionRunId,
        });
      } catch {
        // An ambiguous database failure must not delete objects that may already
        // back a committed marker. Unreferenced objects are safer than a ready
        // row whose Cloudflare backup was deleted.
        throw new RuntimeSubjectCheckpointFailedError({
          cause: error,
          runtimeSubjectId: input.sandboxId,
        });
      }

      const recordedIds = new Set(recordedBackups.map((backup) => backup.id));
      const recordedDirs = new Set(recordedBackups.map((backup) => backup.dir));
      const checkpointRecorded = input.backups.every((entry) => recordedDirs.has(entry.backup.dir));
      const orphanedBackupIds = input.backups
        .map((entry) => entry.backup.id)
        .filter((backupId) => !recordedIds.has(backupId));

      try {
        await deleteSandboxBackupObjects(bindings, orphanedBackupIds);
      } catch (cleanupError) {
        if (!checkpointRecorded) {
          throw new RuntimeSubjectCheckpointFailedError({
            cause: cleanupError,
            runtimeSubjectId: input.sandboxId,
          });
        }

        logWarn("runtime.sandbox_checkpoint.orphan_cleanup_failed", {
          backupCount: orphanedBackupIds.length,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          sandboxId: input.sandboxId,
          sessionRunId: input.sessionRunId,
        });
      }

      if (checkpointRecorded) {
        return;
      }

      throw new RuntimeSubjectCheckpointFailedError({
        cause: error,
        runtimeSubjectId: input.sandboxId,
      });
    }

    await deleteSandboxBackupObjects(
      bindings,
      input.backups.map((entry) => entry.backup.id),
    );
    throw new RuntimeSubjectCheckpointFailedError({
      cause: error,
      runtimeSubjectId: input.sandboxId,
    });
  }
}

async function createSandboxCheckpointBackups(
  bindings: ApiBindings,
  input: {
    readonly operationId?: string | null;
    readonly requiredSessionId?: string;
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
    readonly sessionRunId?: string;
  },
): Promise<void> {
  let targets = await listSandboxCheckpointBackupTargets(bindings.DB, input);

  if (
    input.requiredSessionId !== undefined &&
    !targets.some((target) => target.sessionId === input.requiredSessionId)
  ) {
    throw new RuntimeSubjectCheckpointFailedError({
      cause: new Error(
        `Session ${input.requiredSessionId} has no eligible workspace checkpoint target.`,
      ),
      runtimeSubjectId: input.sandboxId,
    });
  }

  if (targets.length === 0) {
    return;
  }

  if (input.sessionRunId !== undefined) {
    const readyDirs = new Set(
      (
        await listReadySandboxBackupsForSessionRun(bindings.DB, {
          sandboxId: input.sandboxId,
          sessionRunId: input.sessionRunId,
        })
      ).map((backup) => backup.dir),
    );
    targets = targets.filter((target) => !readyDirs.has(target.dir));

    if (targets.length === 0) {
      return;
    }
  }

  const backups = await createSandboxBackupsForTargets(bindings, {
    sandboxId: input.sandboxId,
    targets,
  });

  await recordCreatedCheckpointBackups(bindings, {
    backups,
    ...(input.requiredSessionId === undefined
      ? {}
      : { checkpointSessionId: input.requiredSessionId }),
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    sandboxId: input.sandboxId,
    ...(input.sessionRunId === undefined ? {} : { sessionRunId: input.sessionRunId }),
  });

  try {
    await pruneSandboxBackups(bindings, input.sandboxId);
  } catch (error) {
    if (input.sessionRunId === undefined) {
      throw error;
    }

    logWarn("runtime.sandbox_checkpoint.prune_failed", {
      error: error instanceof Error ? error.message : String(error),
      sandboxId: input.sandboxId,
      sessionRunId: input.sessionRunId,
    });
  }
}

export async function createSandboxCheckpoints(
  bindings: ApiBindings,
  input: {
    operationId?: string | null;
    requiredSessionId?: string;
    rules: readonly RuntimeCheckpointRule[];
    sandboxId: string;
    sessionRunId?: string;
  },
): Promise<void> {
  await createSandboxCheckpointBackups(bindings, input);
}

export async function deleteSandboxBackupsForDir(
  bindings: ApiBindings,
  input: {
    dir: string;
  },
): Promise<void> {
  const backupIds = await listSandboxBackupIdsByDir(bindings.DB, input.dir);

  await deleteSandboxBackupObjects(bindings, backupIds);
  await deleteSandboxBackupRecordsForDir(bindings.DB, input.dir);
}
