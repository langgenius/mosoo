import type { ApiCommandId } from "@mosoo/db";
import type { SandboxBackupId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  environmentPackageArtifactMetadataBackupId,
  publishEnvironmentPackageArtifactBackup,
  resolveEnvironmentPackageArtifactBackup,
} from "../../environments/application/environment-package-artifact-backup";
import {
  claimEnvironmentPackageArtifactBackupActual,
  clearMissingEnvironmentPackageArtifactBackupActual,
  completeEnvironmentPackageArtifactBackupStage,
  getEnvironmentPackageArtifactBackupStage,
  getEnvironmentPackageArtifactCommandIntent,
  retireExpiredEnvironmentPackageArtifactBackups,
  revokeTerminalEnvironmentPackageArtifactBackupStage,
  revokeTerminalEnvironmentPackageArtifactBackupStages,
} from "../../environments/application/environment-package-artifact-backup-store";
import {
  environmentPackageArtifactDir,
  parseEnvironmentPackageArtifactBackupName,
} from "../../environments/domain/environment-package-artifact";
import type {
  EnvironmentPackageArtifactBackupAuthorityRef,
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactPaths,
} from "../../environments/domain/environment-package-artifact";
import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "./sandbox-backup-id";
import {
  deleteAuthorizedSandboxBackupObjects,
  getSandboxBackupObjectKeys,
  parseRuntimeSandboxBackupName,
  parseSandboxBackupMetadata,
} from "./sandbox-backup-platform";
import type { SandboxBackupMetadata } from "./sandbox-backup-platform";
import {
  authorizeSandboxBackupDeletion,
  claimSandboxBackupStageActual,
  finalizeSandboxBackupStage,
  getSandboxBackupRecord,
  getSandboxBackupRecordByStagingId,
  getSandboxBackupStage,
  listPendingSandboxBackupDeletions,
} from "./sandbox-backup-store";
import type { SandboxBackupDeletionAuthority } from "./sandbox-backup-store";

const RECONCILIATION_PAGE_SIZE = 64;
const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const BACKUP_OBJECT_KEY = /^backups\/([^/]+)\/(data\.sqsh|meta\.json)$/u;

export interface SandboxBackupReconciliationPageResult {
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly processed: number;
}

function parseBackupObjectKey(key: string): {
  readonly backupId: SandboxBackupId;
  readonly kind: "data" | "meta";
} | null {
  const match = BACKUP_OBJECT_KEY.exec(key);
  if (match === null) {
    return null;
  }
  try {
    return {
      backupId: encodeSandboxBackupIdForStorage(match[1] ?? ""),
      kind: match[2] === "meta.json" ? "meta" : "data",
    };
  } catch {
    return null;
  }
}

function isPastGrace(uploaded: Date, nowMs: number): boolean {
  return uploaded.getTime() <= nowMs - ORPHAN_GRACE_MS;
}

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

function environmentArtifactPathsEqual(
  left: EnvironmentPackageArtifactPaths,
  right: EnvironmentPackageArtifactPaths,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readEnvironmentArtifactBackup(
  bindings: ApiBindings,
  key: EnvironmentPackageArtifactKey,
): Promise<{
  readonly backupId: SandboxBackupId;
  readonly paths: EnvironmentPackageArtifactPaths;
} | null> {
  const metadata = await resolveEnvironmentPackageArtifactBackup(bindings, key);
  if (metadata === null) {
    return null;
  }
  const backupId = environmentPackageArtifactMetadataBackupId(metadata);
  if (backupId === null) {
    throw new Error("Environment package artifact metadata has an invalid backup ID.");
  }
  return { backupId, paths: metadata.paths };
}

async function deleteEnvironmentArtifactBackupIfUnreferenced(
  bindings: ApiBindings,
  key: EnvironmentPackageArtifactKey,
  backupId: SandboxBackupId,
  authority: {
    readonly attemptCount: number;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
    readonly invalid?: boolean;
  },
): Promise<void> {
  if ((await readEnvironmentArtifactBackup(bindings, key))?.backupId !== backupId) {
    await deleteSandboxBackup(bindings, backupId, {
      attemptCount: authority.attemptCount,
      commandId: authority.commandId,
      deliveryGeneration: authority.deliveryGeneration,
      kind: authority.invalid === true ? "environment_invalid" : "environment_candidate",
    });
  }
}

function parseEnvironmentArtifactCommandId(
  authority: EnvironmentPackageArtifactBackupAuthorityRef,
): ApiCommandId | null {
  try {
    return parsePlatformId<ApiCommandId>(authority.commandId, "environment artifact command ID");
  } catch {
    return null;
  }
}

async function reconcileEnvironmentArtifactMetadataObject(
  bindings: ApiBindings,
  input: {
    readonly authority: EnvironmentPackageArtifactBackupAuthorityRef;
    readonly backupId: SandboxBackupId;
    readonly dataExists: boolean;
    readonly metadata: SandboxBackupMetadata;
    readonly nowMs: number;
    readonly uploaded: Date;
  },
): Promise<void> {
  const commandId = parseEnvironmentArtifactCommandId(input.authority);
  if (commandId === null) {
    return;
  }
  const [stage, intent] = await Promise.all([
    getEnvironmentPackageArtifactBackupStage(bindings.DB, commandId),
    getEnvironmentPackageArtifactCommandIntent(bindings.DB, commandId),
  ]);
  const keySource = stage ?? intent;
  if (keySource === null) {
    return;
  }
  const key: EnvironmentPackageArtifactKey = {
    projectId: keySource.projectId,
    inputDigest: keySource.inputDigest,
  };
  const current = await readEnvironmentArtifactBackup(bindings, key);
  if (current !== null) {
    if (stage !== null) {
      if (!environmentArtifactPathsEqual(stage.paths, current.paths)) {
        logWarn("runtime.environment_artifact.manifest_paths_mismatch", {
          backupId: input.backupId,
          commandId,
        });
        return;
      }
      await completeEnvironmentPackageArtifactBackupStage(bindings.DB, {
        actualBackupId: stage.actualBackupId,
        attemptCount: stage.attemptCount,
        claimOwner: stage.claimOwner,
        commandId: stage.commandId,
        deliveryGeneration: stage.deliveryGeneration,
      });
    }
    if (current.backupId !== input.backupId && isPastGrace(input.uploaded, input.nowMs)) {
      await deleteEnvironmentArtifactBackupIfUnreferenced(bindings, key, input.backupId, {
        attemptCount: input.authority.attemptCount,
        commandId,
        deliveryGeneration: input.authority.deliveryGeneration,
      });
    }
    return;
  }

  const stageMatchesObjectAuthority =
    stage !== null &&
    stage.attemptCount === input.authority.attemptCount &&
    stage.commandId === commandId &&
    stage.deliveryGeneration === input.authority.deliveryGeneration;
  const objectMatchesStage =
    stageMatchesObjectAuthority &&
    input.dataExists &&
    input.metadata.id === decodeSandboxBackupIdForPlatform(input.backupId) &&
    input.metadata.dir === stage.dir &&
    stage.dir === environmentPackageArtifactDir(key);

  if (!objectMatchesStage) {
    if (stageMatchesObjectAuthority && stage.actualBackupId === input.backupId) {
      await clearMissingEnvironmentPackageArtifactBackupActual(bindings.DB, {
        actualBackupId: input.backupId,
        attemptCount: stage.attemptCount,
        claimOwner: stage.claimOwner,
        commandId: stage.commandId,
        deliveryGeneration: stage.deliveryGeneration,
      });
    }
    if (stageMatchesObjectAuthority) {
      await revokeTerminalEnvironmentPackageArtifactBackupStage(bindings.DB, commandId);
    }
    if (isPastGrace(input.uploaded, input.nowMs)) {
      await deleteEnvironmentArtifactBackupIfUnreferenced(bindings, key, input.backupId, {
        attemptCount: input.authority.attemptCount,
        commandId,
        deliveryGeneration: input.authority.deliveryGeneration,
        invalid: true,
      });
    }
    return;
  }

  const claimed = await claimEnvironmentPackageArtifactBackupActual(bindings.DB, {
    actualBackupId: input.backupId,
    authority: {
      attemptCount: stage.attemptCount,
      claimOwner: stage.claimOwner,
      deliveryGeneration: stage.deliveryGeneration,
    },
    commandId,
    dir: stage.dir,
  });
  if (claimed?.actualBackupId === input.backupId) {
    await publishEnvironmentPackageArtifactBackup(bindings, {
      attemptCount: stage.attemptCount,
      backupId: input.backupId,
      claimOwner: stage.claimOwner,
      commandId,
      deliveryGeneration: stage.deliveryGeneration,
      key,
      paths: stage.paths,
    });
    const committed = await readEnvironmentArtifactBackup(bindings, key);
    if (committed !== null && environmentArtifactPathsEqual(stage.paths, committed.paths)) {
      await completeEnvironmentPackageArtifactBackupStage(bindings.DB, {
        actualBackupId: stage.actualBackupId ?? input.backupId,
        attemptCount: stage.attemptCount,
        claimOwner: stage.claimOwner,
        commandId: stage.commandId,
        deliveryGeneration: stage.deliveryGeneration,
      });
      if (committed.backupId === input.backupId) {
        return;
      }
    }
  } else if (claimed === null) {
    await revokeTerminalEnvironmentPackageArtifactBackupStage(bindings.DB, commandId);
  }
  if (isPastGrace(input.uploaded, input.nowMs)) {
    await deleteEnvironmentArtifactBackupIfUnreferenced(bindings, key, input.backupId, {
      attemptCount: input.authority.attemptCount,
      commandId,
      deliveryGeneration: input.authority.deliveryGeneration,
    });
  }
}

async function reconcileMetadataObject(
  bindings: ApiBindings,
  input: { readonly backupId: SandboxBackupId; readonly nowMs: number; readonly uploaded: Date },
): Promise<void> {
  const publicRecord = await getSandboxBackupRecord(bindings.DB, input.backupId);
  if (publicRecord?.status === "pruned") {
    await deleteSandboxBackup(bindings, input.backupId, { kind: "pruned" });
    return;
  }

  const [, metadataKey] = getSandboxBackupObjectKeys(input.backupId);
  const stored = await bindings.SANDBOX_STATE_BUCKET.get(metadataKey);
  if (stored === null) {
    return;
  }
  let metadata = null;
  try {
    metadata = parseSandboxBackupMetadata(JSON.parse(await stored.text()));
  } catch {
    // Unknown or legacy metadata is never owned by this reconciler.
  }
  if (metadata === null) {
    if (publicRecord?.status === "ready") {
      logWarn("runtime.sandbox_backup.ready_metadata_invalid", { backupId: input.backupId });
    }
    return;
  }
  const [dataKey] = getSandboxBackupObjectKeys(input.backupId);
  const data = await bindings.SANDBOX_STATE_BUCKET.head(dataKey);
  if (publicRecord?.status === "ready") {
    if (data === null) {
      logWarn("runtime.sandbox_backup.ready_data_missing", { backupId: input.backupId });
    }
    return;
  }

  const environmentAuthority = parseEnvironmentPackageArtifactBackupName(metadata.name);
  if (environmentAuthority !== null) {
    await reconcileEnvironmentArtifactMetadataObject(bindings, {
      authority: environmentAuthority,
      backupId: input.backupId,
      dataExists: data !== null,
      metadata,
      nowMs: input.nowMs,
      uploaded: input.uploaded,
    });
    return;
  }

  const stagingId = parseRuntimeSandboxBackupName(metadata.name);
  if (stagingId === null) {
    return;
  }
  const finalized = await getSandboxBackupRecordByStagingId(bindings.DB, stagingId);
  if (finalized !== null) {
    if (finalized.id !== input.backupId) {
      await deleteSandboxBackup(bindings, input.backupId, {
        kind: "runtime_candidate",
        stagingId,
      });
    } else if (finalized.status === "pruned") {
      await deleteSandboxBackup(bindings, input.backupId, { kind: "pruned" });
    }
    return;
  }

  const stage = await getSandboxBackupStage(bindings.DB, stagingId);
  if (data === null) {
    if (isPastGrace(input.uploaded, input.nowMs)) {
      await deleteSandboxBackup(bindings, input.backupId, {
        kind: "runtime_invalid",
        stagingId,
      });
    }
    return;
  }
  if (metadata.id !== decodeSandboxBackupIdForPlatform(input.backupId)) {
    if (isPastGrace(input.uploaded, input.nowMs)) {
      await deleteSandboxBackup(bindings, input.backupId, {
        kind: "runtime_invalid",
        stagingId,
      });
    }
    return;
  }
  if (stage === null) {
    if (isPastGrace(input.uploaded, input.nowMs)) {
      await deleteSandboxBackup(bindings, input.backupId, {
        kind: "runtime_candidate",
        stagingId,
      });
    }
    return;
  }
  if (stage.dir !== metadata.dir) {
    if (isPastGrace(input.uploaded, input.nowMs)) {
      await deleteSandboxBackup(bindings, input.backupId, {
        kind: "runtime_invalid",
        stagingId,
      });
    }
    return;
  }

  const claimed = await claimSandboxBackupStageActual(bindings.DB, {
    actualBackupId: input.backupId,
    dir: metadata.dir,
    sandboxIncarnation: stage.sandboxIncarnation,
    stagingId,
  });
  if (claimed === null) {
    await deleteSandboxBackup(bindings, input.backupId, {
      kind: "runtime_candidate",
      stagingId,
    });
    return;
  }
  if (claimed.actualBackupId !== input.backupId) {
    await deleteSandboxBackup(bindings, input.backupId, {
      kind: "runtime_candidate",
      stagingId,
    });
    return;
  }
  const result = await finalizeSandboxBackupStage(bindings.DB, {
    actualBackupId: input.backupId,
    stagingId,
  });
  if (result === null || !result.candidateAccepted) {
    await deleteSandboxBackup(bindings, input.backupId, {
      kind: "runtime_candidate",
      stagingId,
    });
  }
}

async function reconcileDataObject(
  bindings: ApiBindings,
  input: { readonly backupId: SandboxBackupId; readonly nowMs: number; readonly uploaded: Date },
): Promise<void> {
  const publicRecord = await getSandboxBackupRecord(bindings.DB, input.backupId);
  if (publicRecord?.status === "pruned") {
    await deleteSandboxBackup(bindings, input.backupId, { kind: "pruned" });
    return;
  }
  const [, metadataKey] = getSandboxBackupObjectKeys(input.backupId);
  if ((await bindings.SANDBOX_STATE_BUCKET.head(metadataKey)) !== null) {
    return;
  }
  if (publicRecord?.status === "ready") {
    logWarn("runtime.sandbox_backup.ready_metadata_missing", { backupId: input.backupId });
    return;
  }
  if (!isPastGrace(input.uploaded, input.nowMs)) {
    return;
  }
  await deleteSandboxBackup(bindings, input.backupId, { kind: "unattributed" });
}

export async function reconcileSandboxBackupPage(
  bindings: ApiBindings,
  input: { readonly cursor: string | null },
): Promise<SandboxBackupReconciliationPageResult> {
  const clock = await bindings.DB.prepare(
    "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms",
  ).first<{ now_ms: number }>();
  if (clock === null) {
    throw new Error("Sandbox backup reconciliation could not read the D1 clock.");
  }
  const revokedStages = await revokeTerminalEnvironmentPackageArtifactBackupStages(bindings.DB);
  const retired = await retireExpiredEnvironmentPackageArtifactBackups(
    bindings.DB,
    RECONCILIATION_PAGE_SIZE,
  );
  const pending = await listPendingSandboxBackupDeletions(bindings.DB, RECONCILIATION_PAGE_SIZE);
  for (const backupId of pending) {
    try {
      await deleteAuthorizedSandboxBackupObjects(bindings, [backupId]);
    } catch (error) {
      logWarn("runtime.sandbox_backup.pending_deletion_failed", {
        ...createErrorLogContext(error),
        backupId,
      });
    }
  }
  const pendingAfter =
    pending.length === RECONCILIATION_PAGE_SIZE
      ? await listPendingSandboxBackupDeletions(bindings.DB, RECONCILIATION_PAGE_SIZE)
      : [];
  const databaseHasMore =
    revokedStages === RECONCILIATION_PAGE_SIZE ||
    retired.length === RECONCILIATION_PAGE_SIZE ||
    (pendingAfter.length > 0 &&
      (pendingAfter.length !== pending.length ||
        pendingAfter.some((backupId, index) => backupId !== pending[index])));
  const page = await bindings.SANDBOX_STATE_BUCKET.list({
    ...(input.cursor === null ? {} : { cursor: input.cursor }),
    limit: RECONCILIATION_PAGE_SIZE,
    prefix: "backups/",
  });
  for (const object of page.objects) {
    const parsed = parseBackupObjectKey(object.key);
    if (parsed === null) {
      continue;
    }
    try {
      if (parsed.kind === "meta") {
        await reconcileMetadataObject(bindings, {
          backupId: parsed.backupId,
          nowMs: clock.now_ms,
          uploaded: object.uploaded,
        });
      } else {
        await reconcileDataObject(bindings, {
          backupId: parsed.backupId,
          nowMs: clock.now_ms,
          uploaded: object.uploaded,
        });
      }
    } catch (error) {
      logWarn("runtime.sandbox_backup.reconciliation_object_failed", {
        ...createErrorLogContext(error),
        key: object.key,
      });
    }
  }
  return {
    hasMore: page.truncated || databaseHasMore,
    nextCursor: page.truncated ? page.cursor : null,
    processed: page.objects.length,
  };
}
