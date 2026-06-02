import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import type { ExecutionSessionHandle } from "../sandbox-handles";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function getParentDirectory(path: string): string {
  const parts = path.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "/";
  }

  return `/${parts.slice(0, -1).join("/")}`;
}

async function ensureAliasSymlinkMounts(
  session: ExecutionSessionHandle,
  input: {
    aliases: SpaceAliasBinding[];
    sessionId: string;
  },
): Promise<void> {
  const aliasCommands = input.aliases.map((alias) => {
    const aliasParent = getParentDirectory(alias.aliasPath);
    const aliasPath = quoteShellArg(alias.aliasPath);
    const aliasParentPath = quoteShellArg(aliasParent);
    const globalMountPath = quoteShellArg(alias.globalMountPath);
    return `
mkdir -p ${aliasParentPath}
if [ -L ${aliasPath} ] && [ "$(readlink ${aliasPath})" = ${globalMountPath} ]; then
  :
else
  if [ -L ${aliasPath} ]; then unlink ${aliasPath}; fi
  if [ -d ${aliasPath} ]; then rmdir ${aliasPath}; fi
  ln -s ${globalMountPath} ${aliasPath}
fi
`.trim();
  });
  const command = ["set -e", ...aliasCommands].join("\n");

  await withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      session.exec(`sh -lc ${quoteShellArg(command)}`),
      `Sandbox alias symlinks for ${input.sessionId}`,
    ),
    (result) => {
      if (!result.success || result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() ||
            result.stdout.trim() ||
            `Failed to link sandbox aliases for ${input.sessionId}.`,
        );
      }
    },
  );
}

export async function ensureSandboxAliasMounts(input: {
  aliases: SpaceAliasBinding[];
  cloudflareSession: ExecutionSessionHandle;
  sessionId: string;
}): Promise<void> {
  if (input.aliases.length === 0) {
    return;
  }

  await ensureAliasSymlinkMounts(input.cloudflareSession, {
    aliases: input.aliases,
    sessionId: input.sessionId,
  });
}
