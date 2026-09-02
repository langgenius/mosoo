import { discardPromiseResult } from "@mosoo/effects";
import type { SandboxBackupId, SandboxSessionId } from "@mosoo/id";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import { quoteShellArg } from "../../../../shared/shell";
import { getRuntimeSessionOutputDirectory } from "../driver-instance/runtime-session-outputs";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
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
    withRuntimeProvisionTimeout(
      sandbox.exec(`sh -lc ${quoteShellArg(command)}`),
      `Sandbox session cwd probe for ${cwd}`,
    ),
    (result) => result.success && result.exitCode === 0,
  );
}

export async function restoreSandboxConversationDirectoryBackup(
  sandbox: SandboxHandle,
  input: {
    readonly backup: SandboxConversationDirectoryBackup;
    readonly cwd: string;
  },
): Promise<void> {
  await withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      sandbox.restoreBackup({
        dir: input.backup.dir,
        id: decodeSandboxBackupIdForPlatform(input.backup.id),
      }),
      `Sandbox session cwd restore for ${input.cwd}`,
    ),
    discardPromiseResult,
  );
}

export async function prepareSandboxConversationDirectories(input: {
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
}): Promise<void> {
  await withRuntimeProvisionTimeout(
    input.sandbox.mkdir(input.cwd, { recursive: true }),
    `Sandbox session cwd creation for ${input.cwd}`,
  );
  await withRuntimeProvisionTimeout(
    input.sandbox.mkdir(getRuntimeSessionOutputDirectory(input.cwd), { recursive: true }),
    `Sandbox session output directory creation for ${input.cwd}`,
  );
}

export async function deleteSandboxConversationSessionBestEffort(input: {
  readonly sandboxSessionId: SandboxSessionId;
  readonly sandbox: SandboxHandle;
}): Promise<void> {
  try {
    await withRuntimeProvisionTimeout(
      input.sandbox.deleteSession(input.sandboxSessionId),
      `Sandbox session deletion for ${input.sandboxSessionId}`,
    );
  } catch {
    // Best-effort cleanup for a partially configured session.
  }
}

export async function openSandboxConversationSession(input: {
  readonly sandboxSessionId: SandboxSessionId;
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
  readonly shouldCreate: boolean;
}): Promise<{ created: boolean; session: ExecutionSessionHandle }> {
  if (input.shouldCreate) {
    try {
      return {
        created: true,
        session: await withRuntimeProvisionTimeout(
          input.sandbox.createSession({
            cwd: input.cwd,
            id: input.sandboxSessionId,
          }),
          `Sandbox session creation for ${input.sandboxSessionId}`,
        ),
      };
    } catch (error) {
      if (!isSessionAlreadyExistsError(error)) {
        throw error;
      }

      return {
        created: false,
        session: await withRuntimeProvisionTimeout(
          input.sandbox.getSession(input.sandboxSessionId),
          `Sandbox session lookup for ${input.sandboxSessionId}`,
        ),
      };
    }
  }

  return {
    created: false,
    session: await withRuntimeProvisionTimeout(
      input.sandbox.getSession(input.sandboxSessionId),
      `Sandbox session lookup for ${input.sandboxSessionId}`,
    ),
  };
}
