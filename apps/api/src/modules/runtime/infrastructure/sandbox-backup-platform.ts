import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "./sandbox-backup-id";

interface SandboxBackupObject {
  readonly dir: string;
  readonly id: string;
}

function getSandboxBackupObjectKeys(backupId: string): string[] {
  const platformBackupId = decodeSandboxBackupIdForPlatform(backupId);

  return [`backups/${platformBackupId}/data.sqsh`, `backups/${platformBackupId}/meta.json`];
}

export async function createRuntimeSandboxBackup(
  bindings: ApiBindings,
  input: {
    readonly dir: string;
    readonly sandboxId: string;
    readonly ttlSeconds: number;
  },
): Promise<SandboxBackupObject> {
  const { getRuntimeSubjectKeepAliveHandle } =
    await import("./runtime-subject-lifecycle/runtime-subject-lifecycle.service");

  return withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.sandboxId),
    async (sandbox) => {
      await sandbox.mkdir(input.dir, { recursive: true });
      return withDisposedRpcResult(
        sandbox.createBackup({
          dir: input.dir,
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

export async function deleteSandboxBackupObjects(
  bindings: ApiBindings,
  backupIds: readonly string[],
): Promise<void> {
  if (backupIds.length === 0) {
    return;
  }

  const objectKeys = backupIds.flatMap((backupId) => getSandboxBackupObjectKeys(backupId));

  await bindings.SANDBOX_STATE_BUCKET.delete(objectKeys);
}
