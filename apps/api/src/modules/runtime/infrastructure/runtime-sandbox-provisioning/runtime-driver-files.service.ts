import { SANDBOX_CACHE_PATH } from "@mosoo/agent-driver/paths";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import { quoteShellArg } from "../../../../shared/shell";
import type { DriverProfileConfig } from "../../domain/driver-snapshot";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import {
  getParentDirectory,
  listAdditionalDirectories,
} from "./runtime-sandbox-provisioning.paths";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ensureProvisioningDirectories(
  session: ExecutionSessionHandle,
  profile: DriverProfileConfig,
): Promise<void> {
  const directories = listAdditionalDirectories(profile);
  const result = await session.exec(
    `mkdir -p ${directories.map((directory) => quoteShellArg(directory)).join(" ")}`,
  );

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Runtime directory provisioning failed.",
    );
  }
}

export async function ensureRuntimeMemoryMounts(
  session: Pick<ExecutionSessionHandle, "exec">,
  profile: DriverProfileConfig,
): Promise<void> {
  if (profile.runtimeId !== "openai-runtime") {
    return;
  }

  const targetPath = `${profile.session.homePath}/memories`;
  // Keep memory inside the Session checkpoint; never replace restored state.
  const command = [
    "set -eu",
    `if [ -L ${quoteShellArg(targetPath)} ]; then echo 'Legacy runtime memory requires verified migration before this Thread can continue.' >&2; exit 1; fi`,
    `mkdir -p ${quoteShellArg(targetPath)}`,
  ].join("\n");
  const result = await session.exec(`sh -lc ${quoteShellArg(command)}`);
  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `Session runtime memory is unavailable at ${targetPath}.`,
    );
  }
}

export async function runSetupScript(
  session: ExecutionSessionHandle,
  profile: DriverProfileConfig,
): Promise<void> {
  if (!profile.setupScript.trim()) {
    return;
  }

  const artifactPaths = profile.environmentArtifact?.paths;
  const pathEntries: readonly (readonly [string, readonly string[]])[] = [
    ["PATH", artifactPaths?.executable ?? []],
    ["PYTHONPATH", artifactPaths?.python ?? []],
    ["NODE_PATH", artifactPaths?.node ?? []],
  ];
  const pathExports = pathEntries
    .filter(([, paths]) => paths.length > 0)
    .map(([name, paths]) =>
      [`export ${name}=${quoteShellArg(paths.join(":"))}`, "${", name, ":+:$", name, "}"].join(""),
    );
  const setupScript = [...pathExports, profile.setupScript].join("\n");
  const setupScriptPath = `${SANDBOX_CACHE_PATH}/setup/runtime-setup-${profile.session.sandboxSessionId}.sh`;
  const setupMarkerPath = `${SANDBOX_CACHE_PATH}/setup/runtime-setup-${profile.session.sandboxSessionId}.json`;
  const setupMarker = JSON.stringify({ digest: await sha256(setupScript) });
  const markerCheck = await session.exec(
    `sh -lc ${quoteShellArg(
      `test "$(cat ${quoteShellArg(setupMarkerPath)} 2>/dev/null)" = ${quoteShellArg(setupMarker)}`,
    )}`,
  );

  if (markerCheck.success && markerCheck.exitCode === 0) {
    return;
  }

  await session.mkdir(getParentDirectory(setupScriptPath), { recursive: true });
  await session.writeFile(setupScriptPath, setupScript);

  const process = await session.startProcess(`sh -e ${quoteShellArg(setupScriptPath)}`, {
    autoCleanup: true,
    cwd: profile.session.sessionOrganizationPath,
    env: profile.envVars,
  });
  try {
    const exit = await process.waitForExit();

    if (exit.exitCode !== 0) {
      throw new Error(`Runtime setup script failed with exit code ${String(exit.exitCode)}.`);
    }

    await session.writeFile(setupMarkerPath, setupMarker);
  } finally {
    disposeRpcResource(process);
  }
}
