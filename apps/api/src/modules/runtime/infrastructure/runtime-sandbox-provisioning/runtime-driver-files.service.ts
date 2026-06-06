import { SANDBOX_CACHE_PATH, SANDBOX_MEMORY_PATH } from "@mosoo/driver-protocol";
import type { DriverProfileConfig } from "@mosoo/driver-protocol";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import {
  getOrganizationPath,
  getParentDirectory,
  listAdditionalDirectories,
} from "./runtime-sandbox-provisioning.paths";

interface RuntimeMemoryMount {
  sourcePath: string;
  targetRelativePath: string;
}

interface SetupScriptMarker {
  digest: string;
}

type RuntimeMemoryMountsByRuntime = Partial<
  Record<DriverProfileConfig["runtimeId"], RuntimeMemoryMount[]>
>;

const RUNTIME_MEMORY_MOUNTS: RuntimeMemoryMountsByRuntime = {
  "openai-runtime": [
    {
      sourcePath: `${SANDBOX_MEMORY_PATH}/openai-runtime/memories`,
      targetRelativePath: "memories",
    },
  ],
};

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJsonFile<T>(
  session: ExecutionSessionHandle,
  path: string,
  parse: (value: unknown) => T | null,
): Promise<T | null> {
  if (!(await fileExists(session, path))) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse((await session.readFile(path, { encoding: "utf8" })).content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read runtime marker ${path}: ${message}`, { cause: error });
  }

  const value = parse(parsed);

  if (value === null) {
    throw new Error(`Runtime marker ${path} has an invalid shape.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSetupScriptMarker(value: unknown): SetupScriptMarker | null {
  if (!isRecord(value) || typeof value["digest"] !== "string") {
    return null;
  }

  return {
    digest: value["digest"],
  };
}

async function fileExists(session: ExecutionSessionHandle, path: string): Promise<boolean> {
  const quotedPath = quoteShellArg(path);
  const result = await session.exec(
    `sh -lc ${quoteShellArg(
      `if [ -f ${quotedPath} ]; then printf exists; elif [ -e ${quotedPath} ]; then printf other; else printf missing; fi`,
    )}`,
  );

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Runtime marker existence check failed for ${path}.`,
    );
  }

  const state = result.stdout.trim();

  if (state === "exists") {
    return true;
  }

  if (state === "missing") {
    return false;
  }

  if (state === "other") {
    throw new Error(`Runtime marker ${path} exists but is not a file.`);
  }

  throw new Error(`Runtime marker existence check returned unexpected output for ${path}.`);
}

export async function ensureProvisioningDirectories(
  session: ExecutionSessionHandle,
  profile: DriverProfileConfig,
): Promise<void> {
  const directories = listAdditionalDirectories(profile, getOrganizationPath(profile));

  if (directories.length === 0) {
    return;
  }

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
  session: ExecutionSessionHandle,
  profile: DriverProfileConfig,
): Promise<void> {
  const mounts = RUNTIME_MEMORY_MOUNTS[profile.runtimeId] ?? [];

  await Promise.all(
    mounts.map(async (mount) => {
      const targetPath = `${profile.session.homePath}/${mount.targetRelativePath}`;
      const targetParent = getParentDirectory(targetPath);

      // Bind-mounts need CAP_SYS_ADMIN, which the sandbox's unprivileged shell
      // does not have. A symlink gives the runtime the same memory path without
      // requiring a privileged syscall.
      const command = [
        "set -eu",
        `mkdir -p ${quoteShellArg(mount.sourcePath)} ${quoteShellArg(targetParent)}`,
        `if [ -L ${quoteShellArg(targetPath)} ] && [ "$(readlink ${quoteShellArg(targetPath)})" = ${quoteShellArg(mount.sourcePath)} ]; then exit 0; fi`,
        `rm -rf ${quoteShellArg(targetPath)}`,
        `ln -s ${quoteShellArg(mount.sourcePath)} ${quoteShellArg(targetPath)}`,
      ].join("\n");
      const result = await session.exec(`sh -lc ${quoteShellArg(command)}`);

      if (!result.success || result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() ||
            result.stdout.trim() ||
            `Runtime memory link failed for ${targetPath}.`,
        );
      }
    }),
  );
}

export async function runSetupScript(
  session: ExecutionSessionHandle,
  profile: DriverProfileConfig,
): Promise<void> {
  if (!profile.setupScript.trim()) {
    return;
  }

  const organizationPath = getOrganizationPath(profile);
  const setupScriptPath = `${SANDBOX_CACHE_PATH}/setup/runtime-setup-${profile.session.cloudflareSessionId}.sh`;
  const setupMarkerPath = `${SANDBOX_CACHE_PATH}/setup/runtime-setup-${profile.session.cloudflareSessionId}.json`;
  const setupDigest = await sha256(profile.setupScript);
  const marker = await readJsonFile(session, setupMarkerPath, parseSetupScriptMarker);

  if (marker?.digest === setupDigest) {
    return;
  }

  await session.mkdir(getParentDirectory(setupScriptPath), { recursive: true });
  await session.writeFile(setupScriptPath, profile.setupScript);

  const process = await session.startProcess(`sh -e ${quoteShellArg(setupScriptPath)}`, {
    autoCleanup: true,
    cwd: organizationPath,
    env: profile.envVars,
  });
  try {
    const exit = await process.waitForExit();

    if (exit.exitCode !== 0) {
      throw new Error(`Runtime setup script failed with exit code ${String(exit.exitCode)}.`);
    }

    await session.writeFile(
      setupMarkerPath,
      JSON.stringify({
        digest: setupDigest,
      }),
    );
  } finally {
    disposeRpcResource(process);
  }
}
