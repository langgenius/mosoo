import type {
  DriverInstanceId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { shouldBackupSandboxSession } from "../../sessions/domain/session-lifecycle";
import type { RuntimeCheckpointRule } from "../domain/runtime-kind-policy";
import { RuntimeSubjectCheckpointFailedError } from "./runtime-subject-lifecycle/runtime-subject-errors";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-lifecycle/runtime-subject-store";
import {
  createRuntimeSandboxBackup,
  deleteAuthorizedSandboxBackupObjects,
  isRuntimeSandboxBackupObjectReady,
} from "./sandbox-backup-platform";
import { selectSandboxBackupPruneIds } from "./sandbox-backup-pruning";
import type {
  SandboxBackupAdmission,
  SandboxBackupDeletionAuthority,
  SandboxBackupStage,
  SandboxBackupTarget,
} from "./sandbox-backup-store";
import {
  authorizeSandboxBackupDeletion,
  claimSandboxBackupStageActual,
  clearMissingSandboxBackupStageActual,
  deferSandboxBackupStageRepair,
  finalizeSandboxBackupStage,
  getSandboxBackupStage,
  isSandboxBackupStageCurrent,
  listReadySandboxBackupsForPruning,
  listReadySandboxBackupsForSessionRun,
  listSandboxBackupStages,
  listSandboxSessionBackupCandidates,
  markSandboxBackupsPruned,
  revokeSandboxBackupsForSessionDelete,
  revokeSandboxBackupStage,
  stageSandboxBackupWrites,
} from "./sandbox-backup-store";

const BACKUP_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

async function deleteSandboxBackup(
  bindings: ApiBindings,
  backupId: SandboxBackupId,
  authority: SandboxBackupDeletionAuthority,
): Promise<boolean> {
  if (!(await authorizeSandboxBackupDeletion(bindings.DB, { authority, backupId }))) {
    return false;
  }
  await deleteAuthorizedSandboxBackupObjects(bindings, [backupId]);
  return true;
}

export interface TerminalSandboxBackupAuthority {
  readonly driverGeneration: number;
  readonly driverInstanceId: DriverInstanceId;
  readonly incarnation: number;
  readonly sessionId: SessionId;
  readonly sessionRunId: SessionRunId;
}

export interface SandboxSessionBackupTarget {
  readonly cwd: string;
  readonly sessionId: string;
}

async function pruneSandboxBackups(bindings: ApiBindings, sandboxId: string): Promise<void> {
  const backups = await listReadySandboxBackupsForPruning(bindings.DB, sandboxId);
  const candidates = selectSandboxBackupPruneIds(backups);
  const pruned = await markSandboxBackupsPruned(bindings.DB, candidates);
  for (const backupId of pruned) {
    await deleteSandboxBackup(bindings, backupId, { kind: "pruned" });
  }
}

async function listSandboxSessionBackupTargets(
  database: D1Database,
  sandboxId: string,
  sandboxIncarnation: number,
): Promise<SandboxSessionBackupTarget[]> {
  return (await listSandboxSessionBackupCandidates(database, sandboxId, sandboxIncarnation))
    .filter((candidate) =>
      shouldBackupSandboxSession({
        lastMessageAt: candidate.lastMessageAt,
        sessionStatus: candidate.sessionStatus,
      }),
    )
    .map((candidate) => ({ cwd: candidate.cwd, sessionId: candidate.sessionId }));
}

async function listCheckpointTargets(
  database: D1Database,
  input: {
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
    readonly sandboxIncarnation: number;
  },
): Promise<SandboxBackupTarget[]> {
  const targets: SandboxBackupTarget[] = [];
  let sessionTargets: SandboxSessionBackupTarget[] | null = null;
  for (const rule of input.rules) {
    switch (rule.type) {
      case "subject_memory": {
        targets.push({
          dir: rule.path,
          updateSandboxLastBackup: rule.updateSubjectCheckpoint,
          workspaceSessionId: null,
        });
        break;
      }
      case "session_workspaces": {
        sessionTargets ??= await listSandboxSessionBackupTargets(
          database,
          input.sandboxId,
          input.sandboxIncarnation,
        );
        targets.push(
          ...sessionTargets.map((target) => ({
            dir: target.cwd,
            updateSandboxLastBackup: false,
            workspaceSessionId: target.sessionId,
          })),
        );
        break;
      }
    }
  }
  return targets;
}

async function resolveStageActual(
  bindings: ApiBindings,
  initial: SandboxBackupStage,
): Promise<{
  readonly actualId: NonNullable<SandboxBackupStage["actualBackupId"]>;
  readonly stage: SandboxBackupStage;
}> {
  let stage = initial;
  if (stage.actualBackupId !== null) {
    if (
      await isRuntimeSandboxBackupObjectReady(bindings, {
        backupId: stage.actualBackupId,
        dir: stage.dir,
        stagingId: stage.id,
      })
    ) {
      return { actualId: stage.actualBackupId, stage };
    }
    await clearMissingSandboxBackupStageActual(bindings.DB, {
      actualBackupId: stage.actualBackupId,
      stagingId: stage.id,
    });
    const cleared = await getSandboxBackupStage(bindings.DB, stage.id);
    if (cleared === null) {
      throw new Error("Sandbox backup stage was revoked while its object was verified.");
    }
    stage = cleared;
  }

  const candidate = await createRuntimeSandboxBackup(bindings, {
    dir: stage.dir,
    incarnation: stage.sandboxIncarnation,
    sandboxId: stage.sandboxId,
    sessionId: stage.workspaceSessionId,
    stagingId: stage.id,
    ttlSeconds: stage.ttlSeconds,
  });
  if (candidate.dir !== stage.dir) {
    await deleteSandboxBackup(bindings, candidate.id, {
      kind: "runtime_invalid",
      stagingId: stage.id,
    });
    throw new Error("Sandbox backup platform result changed its staged directory.");
  }
  const claimed = await claimSandboxBackupStageActual(bindings.DB, {
    actualBackupId: candidate.id,
    dir: stage.dir,
    sandboxIncarnation: stage.sandboxIncarnation,
    stagingId: stage.id,
  });
  if (claimed === null || claimed.actualBackupId === null) {
    await deleteSandboxBackup(bindings, candidate.id, {
      kind: "runtime_candidate",
      stagingId: stage.id,
    });
    throw new Error("Sandbox backup creation lost its durable stage.");
  }
  if (claimed.actualBackupId !== candidate.id) {
    await deleteSandboxBackup(bindings, candidate.id, {
      kind: "runtime_candidate",
      stagingId: stage.id,
    });
  }
  return { actualId: claimed.actualBackupId, stage };
}

async function createAndFinalizeStage(
  bindings: ApiBindings,
  stage: SandboxBackupStage,
): Promise<void> {
  const { actualId } = await resolveStageActual(bindings, stage);
  const finalized = await finalizeSandboxBackupStage(bindings.DB, {
    actualBackupId: actualId,
    stagingId: stage.id,
  });
  if (finalized === null) {
    await deleteSandboxBackup(bindings, actualId, {
      kind: "runtime_candidate",
      stagingId: stage.id,
    });
    throw new Error("Sandbox backup finalization lost its durable stage.");
  }
  if (!finalized.complete) {
    throw new Error("Sandbox backup finalization did not commit every required relation.");
  }
  if (!finalized.candidateAccepted) {
    await deleteSandboxBackup(bindings, actualId, {
      kind: "runtime_candidate",
      stagingId: stage.id,
    });
  }
}

async function createSandboxCheckpointBackups(
  bindings: ApiBindings,
  input: {
    readonly admission: SandboxBackupAdmission;
    readonly requiredSessionId?: string;
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
  },
): Promise<void> {
  let targets = await listCheckpointTargets(bindings.DB, {
    ...input,
    sandboxIncarnation:
      input.admission.kind === "operation"
        ? input.admission.lease.incarnation
        : input.admission.incarnation,
  });
  if (
    input.requiredSessionId !== undefined &&
    !targets.some((target) => target.workspaceSessionId === input.requiredSessionId)
  ) {
    throw new RuntimeSubjectCheckpointFailedError({
      cause: new Error(`Session ${input.requiredSessionId} has no eligible checkpoint target.`),
      runtimeSubjectId: input.sandboxId,
    });
  }
  if (targets.length === 0) {
    return;
  }
  if (input.admission.kind === "terminal") {
    const readyDirs = new Set(
      (
        await listReadySandboxBackupsForSessionRun(bindings.DB, {
          sandboxId: input.sandboxId,
          sessionRunId: input.admission.sessionRunId,
        })
      ).map((backup) => backup.dir),
    );
    targets = targets.filter((target) => !readyDirs.has(target.dir));
    if (targets.length === 0) {
      return;
    }
  }

  const writes = await stageSandboxBackupWrites(bindings.DB, {
    admission: input.admission,
    sandboxId: input.sandboxId,
    targets,
    ttlSeconds: BACKUP_TTL_SECONDS,
  });
  for (const write of writes) {
    if (write.kind === "finalized") {
      if (write.backup.status !== "ready") {
        throw new Error("A finalized sandbox checkpoint is no longer restorable.");
      }
      continue;
    }
    try {
      await createAndFinalizeStage(bindings, write.stage);
    } catch (cause) {
      throw new RuntimeSubjectCheckpointFailedError({
        cause,
        dir: write.stage.dir,
        runtimeSubjectId: input.sandboxId,
      });
    }
  }

  try {
    await pruneSandboxBackups(bindings, input.sandboxId);
  } catch (error) {
    if (input.admission.kind === "operation") {
      throw error;
    }
    logWarn("runtime.sandbox_checkpoint.prune_failed", {
      error: error instanceof Error ? error.message : String(error),
      sandboxId: input.sandboxId,
      sessionRunId: input.admission.sessionRunId,
    });
  }
}

export async function createSandboxCheckpoints(
  bindings: ApiBindings,
  input: {
    readonly operationLease?: RuntimeSubjectOperationLease;
    readonly requiredSessionId?: string;
    readonly rules: readonly RuntimeCheckpointRule[];
    readonly sandboxId: string;
    readonly terminalAuthority?: TerminalSandboxBackupAuthority;
  },
): Promise<void> {
  if ((input.operationLease === undefined) === (input.terminalAuthority === undefined)) {
    throw new Error("Sandbox checkpoints require exactly one durable admission authority.");
  }
  const admission: SandboxBackupAdmission =
    input.operationLease === undefined
      ? { ...input.terminalAuthority!, kind: "terminal" }
      : { kind: "operation", lease: input.operationLease };
  await createSandboxCheckpointBackups(bindings, { ...input, admission });
}

async function repairSandboxBackupStage(
  bindings: ApiBindings,
  stage: SandboxBackupStage,
): Promise<void> {
  if (!(await isSandboxBackupStageCurrent(bindings.DB, stage.id))) {
    const revoked = await revokeSandboxBackupStage(bindings.DB, {
      onlyIfStale: true,
      stagingId: stage.id,
    });
    if (revoked?.actualBackupId !== null && revoked?.actualBackupId !== undefined) {
      await deleteSandboxBackup(bindings, revoked.actualBackupId, {
        kind: "runtime_candidate",
        stagingId: stage.id,
      });
    }
    return;
  }
  await createAndFinalizeStage(bindings, stage);
}

export async function repairStagedSandboxBackups(
  bindings: ApiBindings,
  limit: number,
): Promise<number> {
  const stages = await listSandboxBackupStages(bindings.DB, limit);
  for (const stage of stages) {
    try {
      await repairSandboxBackupStage(bindings, stage);
    } catch (error) {
      await deferSandboxBackupStageRepair(bindings.DB, stage);
      logWarn("runtime.sandbox_checkpoint.repair_failed", {
        error: error instanceof Error ? error.message : String(error),
        stagingId: stage.id,
      });
    }
  }
  return stages.length;
}

export async function deleteSandboxBackupsForSession(
  bindings: ApiBindings,
  input: {
    readonly cwd: string;
    readonly operationId: string;
    readonly sandboxId: string;
    readonly sessionId: string;
  },
): Promise<void> {
  const backupIds = await revokeSandboxBackupsForSessionDelete(bindings.DB, {
    cwd: input.cwd,
    operationId: parsePlatformId<RuntimeOperationId>(input.operationId, "session delete operation"),
    sandboxId: parsePlatformId<SandboxId>(input.sandboxId, "sandbox id"),
    sessionId: parsePlatformId<SessionId>(input.sessionId, "session id"),
  });
  for (const backupId of backupIds) {
    await deleteSandboxBackup(bindings, backupId, { kind: "unattributed" });
  }
}
