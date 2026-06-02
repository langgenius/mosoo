import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

interface SandboxBackupObject {
  readonly dir: string;
  readonly id: string;
}

function getSandboxStateBucket(bindings: ApiBindings): R2Bucket {
  return (bindings as ApiBindings & { SANDBOX_STATE_BUCKET?: R2Bucket }).SANDBOX_STATE_BUCKET;
}

function getSandboxBackupObjectKeys(backupId: string): string[] {
  return [`backups/${backupId}/data.sqsh`, `backups/${backupId}/meta.json`];
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
    async (sandbox) =>
      withDisposedRpcResult(
        sandbox.createBackup({
          dir: input.dir,
          ttl: input.ttlSeconds,
        }),
        (result) => ({
          dir: result.dir,
          id: result.id,
        }),
      ),
  );
}

export async function deleteSandboxBackupObjects(
  bindings: ApiBindings,
  backupIds: readonly string[],
): Promise<void> {
  if (backupIds.length === 0) {
    return;
  }

  const bucket = getSandboxStateBucket(bindings);
  const objectKeys = backupIds.flatMap((backupId) => getSandboxBackupObjectKeys(backupId));

  await bucket.delete(objectKeys);
}
