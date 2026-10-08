import { parsePlatformId } from "@mosoo/id";
import type { SandboxId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { shouldBackupSandboxSession } from "../../sessions/domain/session-lifecycle";
import { RuntimeSubjectCheckpointFailedError } from "./runtime-subject-lifecycle/runtime-subject-errors";
import { assertExclusiveSessionRuntimeSubject } from "./runtime-subject-lifecycle/runtime-subject-record-store";
import { SANDBOX_BACKUP_TTL_SECONDS } from "./sandbox-backup-config";
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

interface SandboxCheckpointBackupTarget {
  readonly dir: string;
  readonly sanitizeTransientState: boolean;
  readonly sessionId: string | null;
  readonly skipMissingWorkspace: boolean;
}

async function pruneSandboxBackups(
  bindings: ApiBindings,
  sandboxId: string,
  checkpointedDirs: ReadonlySet<string>,
): Promise<void> {
  if (checkpointedDirs.size === 0) return;
  const backups = await listReadySandboxBackupsForPruning(bindings.DB, sandboxId);
  const pruneIds = selectSandboxBackupPruneIds(
    backups.filter((backup) => checkpointedDirs.has(backup.dir)),
  );

  await deleteSandboxBackupObjects(bindings, pruneIds);
  await markSandboxBackupsPruned(bindings.DB, pruneIds);
}

async function listSandboxCheckpointBackupTargets(
  database: D1Database,
  input: { readonly requiredSessionId: string; readonly sandboxId: string },
): Promise<SandboxCheckpointBackupTarget[]> {
  await assertExclusiveSessionRuntimeSubject(
    database,
    parsePlatformId<SandboxId>(input.sandboxId, "Sandbox ID"),
  );
  const candidates = await listSandboxSessionBackupCandidates(database, input.sandboxId);
  return candidates
    .filter(
      (candidate) =>
        candidate.sessionId === input.requiredSessionId &&
        shouldBackupSandboxSession({
          lastMessageAt: candidate.lastMessageAt,
          sessionStatus: candidate.sessionStatus,
        }),
    )
    .map((candidate) => ({
      dir: candidate.cwd,
      sanitizeTransientState: true,
      sessionId: candidate.sessionId,
      skipMissingWorkspace: false,
    }));
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
        sanitizeTransientState: target.sanitizeTransientState,
        sandboxId: input.sandboxId,
        sessionId: target.sessionId,
        skipMissingWorkspace: target.skipMissingWorkspace,
        ttlSeconds: SANDBOX_BACKUP_TTL_SECONDS,
      }).catch((error: unknown) => {
        throw new RuntimeSubjectCheckpointFailedError({
          cause: error,
          dir: target.dir,
          runtimeSubjectId: input.sandboxId,
        });
      }),
    })),
  );
  const createdBackups = results.flatMap((result) =>
    result.status === "fulfilled" && result.value.backup !== null
      ? [{ ...result.value, backup: result.value.backup }]
      : [],
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
      sandboxId: input.sandboxId,
      ...(input.sessionRunId === undefined ? {} : { sessionRunId: input.sessionRunId }),
      ttlSeconds: SANDBOX_BACKUP_TTL_SECONDS,
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
    readonly requiredSessionId: string;
    readonly sandboxId: string;
    readonly sessionRunId: string;
  },
): Promise<void> {
  let targets = await listSandboxCheckpointBackupTargets(bindings.DB, input);
  const checkpointedDirs = new Set<string>();

  if (!targets.some((target) => target.sessionId === input.requiredSessionId)) {
    throw new RuntimeSubjectCheckpointFailedError({
      cause: new Error(
        `Session ${input.requiredSessionId} has no eligible workspace checkpoint target.`,
      ),
      runtimeSubjectId: input.sandboxId,
    });
  }

  {
    const readyDirs = new Set(
      (
        await listReadySandboxBackupsForSessionRun(bindings.DB, {
          sandboxId: input.sandboxId,
          sessionRunId: input.sessionRunId,
        })
      ).map((backup) => backup.dir),
    );
    targets = targets.filter((target) => !readyDirs.has(target.dir));
  }

  if (targets.length > 0) {
    const backups = await createSandboxBackupsForTargets(bindings, {
      sandboxId: input.sandboxId,
      targets,
    });

    await recordCreatedCheckpointBackups(bindings, {
      backups,
      checkpointSessionId: input.requiredSessionId,
      sandboxId: input.sandboxId,
      sessionRunId: input.sessionRunId,
    });
    for (const entry of backups) checkpointedDirs.add(entry.backup.dir);
  }

  try {
    await pruneSandboxBackups(bindings, input.sandboxId, checkpointedDirs);
  } catch (error) {
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
    requiredSessionId: string;
    sandboxId: string;
    sessionRunId: string;
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
