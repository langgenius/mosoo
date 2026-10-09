import { discardPromiseResult } from "@mosoo/effects";
import type { SandboxBackupId, SandboxSessionId } from "@mosoo/id";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import { quoteShellArg } from "../../../../shared/shell";
import { getRuntimeSessionOutputDirectory } from "../driver-instance/runtime-session-outputs";
import { getParentDirectory } from "../runtime-sandbox-provisioning/runtime-sandbox-provisioning.paths";
import { decodeSandboxBackupIdForPlatform } from "../sandbox-backup-id";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";

interface SandboxConversationDirectoryBackup {
  readonly dir: string;
  readonly id: SandboxBackupId;
}

function isSessionAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "SessionAlreadyExistsError" ||
      error.message.includes("SessionAlreadyExistsError") ||
      (error.message.startsWith("Session '") && error.message.includes("' already exists")))
  );
}

export async function sandboxConversationDirectoryHasContent(
  sandbox: SandboxHandle,
  cwd: string,
): Promise<boolean> {
  const command = `test -d ${quoteShellArg(cwd)} && find ${quoteShellArg(cwd)} -mindepth 1 -maxdepth 1 -print -quit | grep -q .`;

  return withDisposedRpcResult(
    sandbox.exec(`sh -lc ${quoteShellArg(command)}`),
    (result) => result.success && result.exitCode === 0,
  );
}

export async function restoreSandboxConversationDirectoryBackup(
  sandbox: SandboxHandle,
  input: {
    readonly backup: SandboxConversationDirectoryBackup;
    readonly localBucket: boolean;
  },
): Promise<void> {
  await sandbox.mkdir(getParentDirectory(input.backup.dir), { recursive: true });
  await withDisposedRpcResult(
    sandbox.restoreBackup({
      dir: input.backup.dir,
      id: decodeSandboxBackupIdForPlatform(input.backup.id),
      localBucket: input.localBucket,
    }),
    discardPromiseResult,
  );
}

export async function prepareSandboxConversationDirectories(input: {
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
}): Promise<void> {
  await input.sandbox.mkdir(input.cwd, { recursive: true });
  await input.sandbox.mkdir(getRuntimeSessionOutputDirectory(input.cwd), { recursive: true });
}

export async function openSandboxConversationSession(input: {
  readonly sandboxSessionId: SandboxSessionId;
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
  readonly shouldCreate: boolean;
}): Promise<ExecutionSessionHandle> {
  if (input.shouldCreate) {
    try {
      return await input.sandbox.createSession({
        cwd: input.cwd,
        id: input.sandboxSessionId,
      });
    } catch (error) {
      // Prewarm and dispatch can both create the first execution session id.
      if (!isSessionAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  return input.sandbox.getSession(input.sandboxSessionId);
}
