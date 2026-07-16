import { discardPromiseResult } from "@mosoo/effects";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { DriverEnvironmentArtifactProfile } from "../../domain/driver-snapshot";
import { isRuntimeSandboxLocalBucketEnabled } from "../runtime-sandbox-bucket-mount";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";
import { getParentDirectory } from "./runtime-sandbox-provisioning.paths";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function exposeEnvironmentNodeModules(
  session: Pick<ExecutionSessionHandle, "exec">,
  input: {
    nodePaths: readonly string[];
    organizationPath: string;
  },
): Promise<void> {
  if (input.nodePaths.length === 0) {
    return;
  }

  const target = `${input.organizationPath}/node_modules`;
  const script = [
    "set -eu",
    `target=${quoteShellArg(target)}`,
    'mkdir -p "$target"',
    `for source in ${input.nodePaths.map(quoteShellArg).join(" ")}; do`,
    '  test -d "$source"',
    '  for package in "$source"/*; do',
    '    test -e "$package" || continue',
    "    name=${package##*/}",
    '    if test "${name#@}" != "$name"; then',
    '      mkdir -p "$target/$name"',
    '      for scoped_package in "$package"/*; do',
    '        test -e "$scoped_package" || continue',
    "        scoped_name=${scoped_package##*/}",
    '        test -e "$target/$name/$scoped_name" || ln -s "$scoped_package" "$target/$name/$scoped_name"',
    "      done",
    "    else",
    '      test -e "$target/$name" || ln -s "$package" "$target/$name"',
    "    fi",
    "  done",
    "done",
  ].join("\n");
  const result = await session.exec(`sh -lc ${quoteShellArg(script)}`);

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Environment npm packages could not be exposed.",
    );
  }
}

export async function restoreEnvironmentArtifact(
  bindings: ApiBindings,
  sandbox: SandboxHandle,
  profile: DriverEnvironmentArtifactProfile,
): Promise<void> {
  await sandbox.mkdir(getParentDirectory(profile.backupDir), { recursive: true });
  await withDisposedRpcResult(
    sandbox.restoreBackup({
      dir: profile.backupDir,
      id: profile.backupId,
      localBucket: isRuntimeSandboxLocalBucketEnabled(bindings),
    }),
    discardPromiseResult,
  );
}
