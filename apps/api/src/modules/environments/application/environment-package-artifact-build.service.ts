import {
  disposeRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import { requireCloudflareSandboxBinding } from "../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { EnvironmentPackageArtifactBuildCommandPayload } from "../../api-command/application/api-command-payload";
import { isRuntimeSandboxLocalBucketEnabled } from "../../runtime/infrastructure/runtime-sandbox-bucket-mount";
import { deleteSandboxBackupObjects } from "../../runtime/infrastructure/sandbox-backup-platform";
import type { SandboxHandle } from "../../runtime/infrastructure/sandbox-handles";
import { toSandboxHandle } from "../../runtime/infrastructure/sandbox-handles";
import {
  createEnvironmentPackageArtifactKey,
  environmentPackageArtifactDir,
  environmentPackageArtifactMetadataKey,
  environmentPackageArtifactSandboxId,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
  ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS,
} from "../domain/environment-package-artifact";
import type { EnvironmentPackageArtifactPaths } from "../domain/environment-package-artifact";
import { normalizePackages } from "./environment-config";
import { readEnvironmentPackageArtifactMetadata } from "./environment-package-artifact.service";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createEnvironmentPackageArtifactBuildScript(input: {
  npmRoot: string;
  npmSpecs: readonly string[];
  pipRoot: string;
  pipSpecs: readonly string[];
  tempRoot: string;
}): string {
  const commands = [
    "set -eu",
    `export HOME=${quoteShellArg(`${input.tempRoot}/home`)}`,
    'mkdir -p "$HOME"',
  ];
  if (input.npmSpecs.length > 0) {
    commands.push(
      `npm install --prefix ${quoteShellArg(input.npmRoot)} --no-audit --no-fund --save-exact ${input.npmSpecs.map(quoteShellArg).join(" ")}`,
    );
  }
  if (input.pipSpecs.length > 0) {
    commands.push(
      `python -m pip install --disable-pip-version-check --no-input --ignore-installed --prefix ${quoteShellArg(input.pipRoot)} ${input.pipSpecs.map(quoteShellArg).join(" ")}`,
      `find ${quoteShellArg(input.pipRoot)} -type d -name __pycache__ -prune -exec rm -rf {} +`,
    );
  }
  const pythonLayout =
    'import sys,sysconfig; p=sys.argv[1]; print(sysconfig.get_path("scripts",vars={"base":p,"platbase":p})); print(sysconfig.get_path("purelib",vars={"base":p,"platbase":p}))';
  commands.push(`python -c ${quoteShellArg(pythonLayout)} ${quoteShellArg(input.pipRoot)}`);
  return commands.join("\n");
}

async function closeBuildSandbox(sandbox: SandboxHandle): Promise<void> {
  try {
    await sandbox.destroy();
  } finally {
    disposeRpcResource(sandbox);
  }
}

export async function buildEnvironmentPackageArtifact(
  bindings: ApiBindings,
  payload: EnvironmentPackageArtifactBuildCommandPayload,
): Promise<void> {
  const packages = normalizePackages(payload.packages);
  const key = await createEnvironmentPackageArtifactKey({
    appId: payload.appId,
    artifactAbi: payload.artifactAbi,
    packages,
  });
  if (key.inputDigest !== payload.inputDigest) {
    throw new Error("Environment package artifact digest does not match its payload.");
  }
  if ((await readEnvironmentPackageArtifactMetadata(bindings, key)) !== null) {
    return;
  }

  const npmSpecs = packages.find(({ manager }) => manager === "npm")?.packages ?? [];
  const pipSpecs = packages.find(({ manager }) => manager === "pip")?.packages ?? [];
  const dir = environmentPackageArtifactDir(key);
  const tempRoot = `/tmp/mosoo-environment-artifact-${key.inputDigest}`;
  const npmRoot = `${dir}/npm`;
  const pipRoot = `${dir}/python`;
  let backupId: string | null = null;
  const { getSandbox } = await import("@cloudflare/sandbox");
  const sandbox = toSandboxHandle(
    getSandbox(
      requireCloudflareSandboxBinding(bindings),
      environmentPackageArtifactSandboxId(key),
      { keepAlive: true, normalizeId: true },
    ),
  );

  try {
    const reset = await sandbox.exec(
      `rm -rf ${quoteShellArg(dir)} ${quoteShellArg(tempRoot)} && mkdir -p ${quoteShellArg(dir)} ${quoteShellArg(tempRoot)}`,
    );
    if (!reset.success) {
      throw new Error("Environment package build directory could not be prepared.");
    }
    const result = await sandbox.exec(
      createEnvironmentPackageArtifactBuildScript({
        npmRoot,
        npmSpecs,
        pipRoot,
        pipSpecs,
        tempRoot,
      }),
      { timeout: ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS },
    );
    if (!result.success) {
      const tail = `${result.stdout}\n${result.stderr}`.trim().slice(-4096);
      throw new Error(tail || "Environment package installation failed.");
    }
    const [pipBin = "", pipSite = ""] = result.stdout.trim().split("\n").slice(-2);
    if (!pipBin.startsWith(`${pipRoot}/`) || !pipSite.startsWith(`${pipRoot}/`)) {
      throw new Error("Python package layout is invalid.");
    }

    const paths: EnvironmentPackageArtifactPaths = {
      executable: [
        ...(npmSpecs.length > 0 ? [`${npmRoot}/node_modules/.bin`] : []),
        ...(pipSpecs.length > 0 ? [pipBin] : []),
      ],
      node: npmSpecs.length === 0 ? [] : [`${npmRoot}/node_modules`],
      python: pipSpecs.length === 0 ? [] : [pipSite],
    };
    const backup = await withDisposedRpcResult(
      sandbox.createBackup({
        dir,
        localBucket: isRuntimeSandboxLocalBucketEnabled(bindings),
        ttl: ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
      }),
      (backupResult) => ({ dir: backupResult.dir, id: backupResult.id }),
    );
    backupId = backup.id;
    if (!backupId || backup.dir !== dir) {
      throw new Error("Environment package artifact backup is invalid.");
    }
    await bindings.SANDBOX_STATE_BUCKET.put(
      environmentPackageArtifactMetadataKey(key),
      JSON.stringify({ backupId, paths }),
      { httpMetadata: { contentType: "application/json" } },
    );
    backupId = null;
  } catch (error) {
    if (backupId !== null) {
      await deleteSandboxBackupObjects(bindings, [backupId]).catch(() => undefined);
    }
    throw error;
  } finally {
    await closeBuildSandbox(sandbox);
  }
}
