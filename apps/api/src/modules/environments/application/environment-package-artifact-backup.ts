import type { ApiCommandId } from "@mosoo/db";
import type { SandboxBackupId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "../../runtime/infrastructure/sandbox-backup-id";
import {
  getSandboxBackupObjectKeys,
  parseSandboxBackupMetadata,
} from "../../runtime/infrastructure/sandbox-backup-platform";
import { authorizeSandboxBackupDeletion } from "../../runtime/infrastructure/sandbox-backup-store";
import {
  createEnvironmentPackageArtifactBackupName,
  environmentPackageArtifactDir,
  environmentPackageArtifactMetadataKey,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
  parseEnvironmentPackageArtifactBackupName,
  parseEnvironmentPackageArtifactMetadata,
} from "../domain/environment-package-artifact";
import type {
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactMetadata,
  EnvironmentPackageArtifactPaths,
} from "../domain/environment-package-artifact";
import {
  adoptLegacyEnvironmentPackageArtifactBackup,
  commitEnvironmentPackageArtifactBackup,
  findEnvironmentPackageArtifactCommandAuthority,
  getEnvironmentPackageArtifactBackupManifest,
  getEnvironmentPackageArtifactCommandIntent,
} from "./environment-package-artifact-backup-store";

export function environmentPackageArtifactMetadataBackupId(
  metadata: EnvironmentPackageArtifactMetadata,
): SandboxBackupId | null {
  try {
    return encodeSandboxBackupIdForStorage(metadata.backupId);
  } catch {
    return null;
  }
}

interface EnvironmentPackageArtifactBackupVerification {
  readonly authority: {
    readonly attemptCount: number;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
  } | null;
  readonly expiresAt: number;
}

async function readEnvironmentPackageArtifactBackupVerification(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  input: { readonly backupId: SandboxBackupId; readonly dir: string },
): Promise<EnvironmentPackageArtifactBackupVerification | null> {
  const [dataKey, metadataKey] = getSandboxBackupObjectKeys(input.backupId);
  const [data, storedMetadata] = await Promise.all([
    bindings.SANDBOX_STATE_BUCKET.head(dataKey),
    bindings.SANDBOX_STATE_BUCKET.get(metadataKey),
  ]);
  if (data === null || storedMetadata === null) {
    return null;
  }
  let metadata = null;
  let createdAt: unknown;
  let ttl: unknown;
  try {
    const value = JSON.parse(await storedMetadata.text()) as unknown;
    metadata = parseSandboxBackupMetadata(value);
    createdAt =
      typeof value === "object" && value !== null ? Reflect.get(value, "createdAt") : null;
    ttl = typeof value === "object" && value !== null ? Reflect.get(value, "ttl") : null;
  } catch {
    return null;
  }
  if (
    metadata?.id !== decodeSandboxBackupIdForPlatform(input.backupId) ||
    metadata.dir !== input.dir
  ) {
    return null;
  }
  const createdAtMs = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  const expiresAt = createdAtMs + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000;
  if (
    !Number.isSafeInteger(createdAtMs) ||
    new Date(createdAtMs).toISOString() !== createdAt ||
    ttl !== ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return null;
  }
  if (metadata.name === null) {
    return { authority: null, expiresAt };
  }
  const authority = parseEnvironmentPackageArtifactBackupName(metadata.name);
  if (authority === null) {
    return null;
  }
  try {
    return {
      authority: {
        attemptCount: authority.attemptCount,
        commandId: parsePlatformId<ApiCommandId>(
          authority.commandId,
          "environment artifact command ID",
        ),
        deliveryGeneration: authority.deliveryGeneration,
      },
      expiresAt,
    };
  } catch {
    return null;
  }
}

export async function isEnvironmentPackageArtifactBackupReady(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  input: {
    readonly attemptCount: number;
    readonly backupId: SandboxBackupId;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
    readonly dir: string;
  },
): Promise<boolean> {
  const verified = await readEnvironmentPackageArtifactBackupVerification(bindings, input);
  return (
    verified?.authority?.commandId === input.commandId &&
    verified.authority.deliveryGeneration === input.deliveryGeneration &&
    verified.authority.attemptCount === input.attemptCount
  );
}

async function readLegacyEnvironmentPackageArtifactMetadata(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  key: EnvironmentPackageArtifactKey,
): Promise<EnvironmentPackageArtifactMetadata | null> {
  const object = await bindings.SANDBOX_STATE_BUCKET.get(
    environmentPackageArtifactMetadataKey(key),
  );
  if (object === null) {
    return null;
  }
  try {
    return parseEnvironmentPackageArtifactMetadata(
      JSON.parse(await object.text()),
      environmentPackageArtifactDir(key),
    );
  } catch {
    return null;
  }
}

export async function resolveEnvironmentPackageArtifactBackup(
  bindings: Pick<ApiBindings, "DB" | "SANDBOX_STATE_BUCKET">,
  key: EnvironmentPackageArtifactKey,
): Promise<EnvironmentPackageArtifactMetadata | null> {
  const manifest = await getEnvironmentPackageArtifactBackupManifest(bindings.DB, key);
  const clock = await bindings.DB.prepare(
    "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms",
  ).first<{ now_ms: number }>();
  if (clock === null) {
    return null;
  }
  if (manifest !== null) {
    if (
      manifest.expiresAt <=
      clock.now_ms + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS
    ) {
      return null;
    }
    const verified = await readEnvironmentPackageArtifactBackupVerification(bindings, {
      backupId: manifest.backupId,
      dir: environmentPackageArtifactDir(key),
    });
    const command = await getEnvironmentPackageArtifactCommandIntent(
      bindings.DB,
      manifest.commandId,
    );
    if (
      verified === null ||
      command === null ||
      command.projectId !== key.projectId ||
      command.inputDigest !== key.inputDigest ||
      command.commandId !== manifest.commandId ||
      verified.expiresAt !== manifest.expiresAt ||
      (verified.authority !== null &&
        (verified.authority.commandId !== manifest.commandId ||
          verified.authority.deliveryGeneration !== manifest.deliveryGeneration ||
          verified.authority.attemptCount !== manifest.attemptCount))
    ) {
      return null;
    }
    return {
      backupId: decodeSandboxBackupIdForPlatform(manifest.backupId),
      paths: manifest.paths,
    };
  }

  const projection = await readLegacyEnvironmentPackageArtifactMetadata(bindings, key);
  if (projection === null) {
    return null;
  }
  const backupId = environmentPackageArtifactMetadataBackupId(projection);
  if (backupId === null) {
    return null;
  }
  const verified = await readEnvironmentPackageArtifactBackupVerification(bindings, {
    backupId,
    dir: environmentPackageArtifactDir(key),
  });
  if (
    verified === null ||
    verified.expiresAt <= clock.now_ms + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS ||
    verified.expiresAt > clock.now_ms + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000
  ) {
    return null;
  }
  const command =
    verified.authority === null
      ? await findEnvironmentPackageArtifactCommandAuthority(bindings.DB, key)
      : await getEnvironmentPackageArtifactCommandIntent(bindings.DB, verified.authority.commandId);
  if (
    command === null ||
    command.projectId !== key.projectId ||
    command.inputDigest !== key.inputDigest ||
    (verified.authority !== null &&
      (verified.authority.commandId !== command.commandId ||
        verified.authority.deliveryGeneration !== command.deliveryGeneration ||
        verified.authority.attemptCount !== command.attemptCount)) ||
    !(await adoptLegacyEnvironmentPackageArtifactBackup(bindings.DB, {
      actualBackupId: backupId,
      expiresAt: verified.expiresAt,
      ...command,
      key,
      paths: projection.paths,
    }))
  ) {
    logWarn("runtime.environment_artifact.legacy_projection_adoption_failed", {
      backupId,
      inputDigest: key.inputDigest,
    });
    return null;
  }
  return projection;
}

export async function publishEnvironmentPackageArtifactBackup(
  bindings: Pick<ApiBindings, "DB" | "SANDBOX_STATE_BUCKET">,
  input: {
    readonly attemptCount: number;
    readonly backupId: SandboxBackupId;
    readonly claimOwner: string;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
    readonly key: EnvironmentPackageArtifactKey;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): Promise<void> {
  const verified = await readEnvironmentPackageArtifactBackupVerification(bindings, {
    backupId: input.backupId,
    dir: environmentPackageArtifactDir(input.key),
  });
  if (
    verified?.authority?.commandId !== input.commandId ||
    verified.authority.deliveryGeneration !== input.deliveryGeneration ||
    verified.authority.attemptCount !== input.attemptCount
  ) {
    throw new Error("Environment package artifact backup objects are incomplete.");
  }
  const committed = await commitEnvironmentPackageArtifactBackup(bindings.DB, {
    actualBackupId: input.backupId,
    attemptCount: input.attemptCount,
    claimOwner: input.claimOwner,
    commandId: input.commandId,
    deliveryGeneration: input.deliveryGeneration,
    expiresAt: verified.expiresAt,
    key: input.key,
    paths: input.paths,
  });
  const manifest = await getEnvironmentPackageArtifactBackupManifest(bindings.DB, input.key);
  if (!committed || manifest?.backupId !== input.backupId) {
    if (manifest !== null && manifest.backupId !== input.backupId) {
      await authorizeSandboxBackupDeletion(bindings.DB, {
        authority: {
          attemptCount: input.attemptCount,
          commandId: input.commandId,
          deliveryGeneration: input.deliveryGeneration,
          kind: "environment_invalid",
        },
        backupId: input.backupId,
      });
      return;
    }
    throw new Error("Environment package artifact backup lost D1 commit authority.");
  }
}

export { createEnvironmentPackageArtifactBackupName };
