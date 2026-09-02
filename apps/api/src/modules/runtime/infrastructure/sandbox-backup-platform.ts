import { getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";
import type { SandboxBackupId } from "@mosoo/id";

import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "./sandbox-backup-id";
import {
  beginSandboxBackupDeletionAttempt,
  completeSandboxBackupDeletion,
  isSandboxBackupDeletionAuthorized,
} from "./sandbox-backup-store";
import { toRuntimeSubjectIncarnationHandle } from "./sandbox-handles";

const RUNTIME_SANDBOX_BACKUP_NAME_PREFIX = "mosoo:runtime-backup:v1:";

export interface SandboxBackupObject {
  readonly dir: string;
  readonly id: SandboxBackupId;
}

export interface SandboxBackupMetadata {
  readonly dir: string;
  readonly id: string;
  readonly name: string | null;
}

export function createRuntimeSandboxBackupName(stagingId: SandboxBackupId): string {
  return `${RUNTIME_SANDBOX_BACKUP_NAME_PREFIX}${stagingId}`;
}

export function parseRuntimeSandboxBackupName(value: string | null): SandboxBackupId | null {
  if (value === null || !value.startsWith(RUNTIME_SANDBOX_BACKUP_NAME_PREFIX)) {
    return null;
  }
  const stagingId = value.slice(RUNTIME_SANDBOX_BACKUP_NAME_PREFIX.length);
  try {
    return encodeSandboxBackupIdForStorage(stagingId);
  } catch {
    return null;
  }
}

export function parseSandboxBackupMetadata(value: unknown): SandboxBackupMetadata | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const dir = Reflect.get(value, "dir");
  const id = Reflect.get(value, "id");
  const name = Reflect.get(value, "name");
  return typeof dir === "string" &&
    dir.length > 0 &&
    typeof id === "string" &&
    (name === null || typeof name === "string")
    ? { dir, id, name }
    : null;
}

export function getSandboxBackupObjectKeys(backupId: string): readonly [string, string] {
  const platformId = decodeSandboxBackupIdForPlatform(backupId);
  return [`backups/${platformId}/data.sqsh`, `backups/${platformId}/meta.json`];
}

async function readSandboxBackupMetadata(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  backupId: SandboxBackupId,
): Promise<SandboxBackupMetadata | null> {
  const [, metadataKey] = getSandboxBackupObjectKeys(backupId);
  const stored = await bindings.SANDBOX_STATE_BUCKET.get(metadataKey);
  if (stored === null) {
    return null;
  }
  try {
    return parseSandboxBackupMetadata(JSON.parse(await stored.text()));
  } catch {
    return null;
  }
}

export async function isRuntimeSandboxBackupObjectReady(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  input: {
    readonly backupId: SandboxBackupId;
    readonly dir: string;
    readonly stagingId: SandboxBackupId;
  },
): Promise<boolean> {
  const [dataKey] = getSandboxBackupObjectKeys(input.backupId);
  const [data, metadata] = await Promise.all([
    bindings.SANDBOX_STATE_BUCKET.head(dataKey),
    readSandboxBackupMetadata(bindings, input.backupId),
  ]);
  return (
    data !== null &&
    metadata?.id === decodeSandboxBackupIdForPlatform(input.backupId) &&
    metadata.dir === input.dir &&
    parseRuntimeSandboxBackupName(metadata.name) === input.stagingId
  );
}

export async function createRuntimeSandboxBackup(
  bindings: ApiBindings,
  input: {
    readonly dir: string;
    readonly incarnation: number;
    readonly sandboxId: string;
    readonly sessionId: string | null;
    readonly stagingId: SandboxBackupId;
    readonly ttlSeconds: number;
  },
): Promise<SandboxBackupObject> {
  const { getRuntimeSubjectKeepAliveHandle } =
    await import("./runtime-subject-lifecycle/runtime-subject-lifecycle.service");
  return withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.sandboxId, input.incarnation),
    async (sandbox) => {
      const forbiddenPaths =
        input.sessionId === null
          ? undefined
          : [`${getSessionRuntimeStatePath(input.sessionId, "openai-runtime")}/auth.json`];
      return withDisposedRpcResult(
        toRuntimeSubjectIncarnationHandle(sandbox).createRuntimeSubjectBackup(input.incarnation, {
          dir: input.dir,
          ...(forbiddenPaths === undefined ? {} : { forbiddenPaths }),
          name: createRuntimeSandboxBackupName(input.stagingId),
          ttl: input.ttlSeconds,
        }),
        (result) => ({
          dir: result.dir,
          id: encodeSandboxBackupIdForStorage(result.id),
        }),
      );
    },
  );
}

export async function deleteAuthorizedSandboxBackupObjects(
  bindings: Pick<ApiBindings, "DB" | "SANDBOX_STATE_BUCKET">,
  backupIds: readonly SandboxBackupId[],
): Promise<void> {
  for (const backupId of new Set(backupIds)) {
    if (!(await isSandboxBackupDeletionAuthorized(bindings.DB, backupId))) {
      throw new Error("Sandbox backup object deletion lacks a durable D1 intent.");
    }
    await beginSandboxBackupDeletionAttempt(bindings.DB, backupId);
    await bindings.SANDBOX_STATE_BUCKET.delete([...getSandboxBackupObjectKeys(backupId)]);
    await completeSandboxBackupDeletion(bindings.DB, backupId);
  }
}
