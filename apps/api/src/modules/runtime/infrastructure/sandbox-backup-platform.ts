import {
  getSessionResourceRootPath,
  getSessionRuntimeStatePath,
  getSessionStateRootPath,
} from "@mosoo/agent-driver/paths";

import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  decodeSandboxBackupIdForPlatform,
  encodeSandboxBackupIdForStorage,
} from "./sandbox-backup-id";
import type { SandboxHandle } from "./sandbox-handles";

interface SandboxBackupObject {
  readonly dir: string;
  readonly id: string;
}

function isMissingRuntimeBucketMountError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No active mount found at path:");
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function prepareRuntimeSessionWorkspaceCheckpoint(
  sandbox: SandboxHandle,
  input: {
    readonly cwd: string;
    readonly sessionId: string;
  },
): Promise<void> {
  const resourceRoot = getSessionResourceRootPath(input.sessionId);
  const stateRoot = getSessionStateRootPath(input.sessionId);
  const openAiAuthPath = `${getSessionRuntimeStatePath(input.sessionId, "openai-runtime")}/auth.json`;

  if (!resourceRoot.startsWith(`${input.cwd}/`) || !stateRoot.startsWith(`${input.cwd}/`)) {
    throw new Error("Session checkpoint exclusions must stay inside the session workspace.");
  }

  try {
    await sandbox.unmountBucket(resourceRoot);
  } catch (error) {
    if (!isMissingRuntimeBucketMountError(error)) {
      throw error;
    }
  }

  const command = [
    "set -eu",
    `cwd=${quoteShellArg(input.cwd)}`,
    'test -d "$cwd"',
    `resource_root=${quoteShellArg(resourceRoot)}`,
    'if [ -L "$resource_root" ]; then unlink "$resource_root"; elif mountpoint -q "$resource_root"; then fusermount -u "$resource_root"; fi',
    'if [ -e "$resource_root" ]; then rm -rf "$resource_root"; fi',
    `state_root=${quoteShellArg(stateRoot)}`,
    'if [ -d "$state_root" ]; then find "$state_root" -type f -name "driver-boot-payload-*.json" -delete; fi',
    `rm -f ${quoteShellArg(openAiAuthPath)}`,
    "sync",
  ].join("; ");

  await withDisposedRpcResult(sandbox.exec(`sh -lc ${quoteShellArg(command)}`), (result) => {
    if (!result.success || result.exitCode !== 0) {
      const detail = result.stderr.trim();
      throw new Error(
        `Session workspace could not be prepared for a credential-safe checkpoint${detail ? `: ${detail}` : "."}`,
      );
    }
  });
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
    readonly sessionId: string | null;
    readonly ttlSeconds: number;
  },
): Promise<SandboxBackupObject> {
  const { getRuntimeSubjectKeepAliveHandle } =
    await import("./runtime-subject-lifecycle/runtime-subject-lifecycle.service");

  return withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.sandboxId),
    async (sandbox) => {
      if (input.sessionId !== null) {
        await prepareRuntimeSessionWorkspaceCheckpoint(sandbox, {
          cwd: input.dir,
          sessionId: input.sessionId,
        });
      } else {
        await sandbox.mkdir(input.dir, { recursive: true });
      }

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
