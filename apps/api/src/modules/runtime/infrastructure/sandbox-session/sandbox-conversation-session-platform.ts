import { discardPromiseResult } from "@mosoo/effects";
import type { SandboxBackupId, SandboxSessionId, SessionId } from "@mosoo/id";
import { getSessionSpaceRootPath } from "agent-driver/paths";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";

interface SandboxConversationDirectoryBackup {
  readonly dir: string;
  readonly id: SandboxBackupId;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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
        id: input.backup.id,
      }),
      `Sandbox session cwd restore for ${input.cwd}`,
    ),
    discardPromiseResult,
  );
}

export async function prepareSandboxConversationDirectories(input: {
  readonly createSpaceRoot: boolean;
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
  readonly sessionId: SessionId;
}): Promise<void> {
  if (!input.createSpaceRoot) {
    await input.sandbox.mkdir(input.cwd, { recursive: true });
    return;
  }

  await Promise.all([
    input.sandbox.mkdir(input.cwd, { recursive: true }),
    input.sandbox.mkdir(getSessionSpaceRootPath(input.sessionId), { recursive: true }),
  ]);
}

export async function deleteSandboxConversationSessionBestEffort(input: {
  readonly cloudflareSessionId: SandboxSessionId;
  readonly sandbox: SandboxHandle;
}): Promise<void> {
  try {
    await input.sandbox.deleteSession(input.cloudflareSessionId);
  } catch {
    // Best-effort cleanup for a partially configured session.
  }
}

export async function openSandboxConversationSession(input: {
  readonly cloudflareSessionId: SandboxSessionId;
  readonly cwd: string;
  readonly sandbox: SandboxHandle;
  readonly shouldCreate: boolean;
}): Promise<{ created: boolean; session: ExecutionSessionHandle }> {
  if (input.shouldCreate) {
    try {
      return {
        created: true,
        session: await input.sandbox.createSession({
          cwd: input.cwd,
          id: input.cloudflareSessionId,
        }),
      };
    } catch (error) {
      if (!isSessionAlreadyExistsError(error)) {
        throw error;
      }

      return {
        created: false,
        session: await input.sandbox.getSession(input.cloudflareSessionId),
      };
    }
  }

  return {
    created: false,
    session: await input.sandbox.getSession(input.cloudflareSessionId),
  };
}
