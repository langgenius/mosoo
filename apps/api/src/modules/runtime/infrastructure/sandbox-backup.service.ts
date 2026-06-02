import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { shouldBackupSandboxSession } from "../../sessions/domain/session-lifecycle";
import type { RuntimeCheckpointRule } from "../domain/runtime-kind-policy";
import { RuntimeSubjectCheckpointFailedError } from "./runtime-subject-lifecycle/runtime-subject-errors";
import { createRuntimeSandboxBackup, deleteSandboxBackupObjects } from "./sandbox-backup-platform";
import { selectSandboxBackupPruneIds } from "./sandbox-backup-pruning";
import type { CreatedSandboxBackupWrite } from "./sandbox-backup-store";
import {
  deleteSandboxBackupRecordsForDir,
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
          updateSandboxLastBackup: rule.updateSubjectCheckpoint,
        });
        break;
      }
      case "session_workspaces": {
        sessionTargets ??= await listSandboxSessionBackupTargets(database, input.sandboxId);
        targets.push(
          ...sessionTargets.map((target) => ({
            dir: target.cwd,
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
    readonly operationId?: string | null;
    readonly sandboxId: string;
  },
): Promise<void> {
  try {
    await recordCreatedSandboxBackups(bindings.DB, {
      backups: input.backups,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      sandboxId: input.sandboxId,
      ttlSeconds: BACKUP_TTL_SECONDS,
    });
  } catch (error) {
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
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
  },
): Promise<void> {
  const targets = await listSandboxCheckpointBackupTargets(bindings.DB, input);

  if (targets.length === 0) {
    return;
  }

  const backups = await createSandboxBackupsForTargets(bindings, {
    sandboxId: input.sandboxId,
    targets,
  });

  await recordCreatedCheckpointBackups(bindings, {
    backups,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    sandboxId: input.sandboxId,
  });
  await pruneSandboxBackups(bindings, input.sandboxId);
}

export async function createSandboxCheckpoints(
  bindings: ApiBindings,
  input: {
    operationId?: string | null;
    rules: readonly RuntimeCheckpointRule[];
    sandboxId: string;
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
