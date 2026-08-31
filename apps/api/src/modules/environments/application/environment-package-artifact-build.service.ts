import type { ApiCommandId } from "@mosoo/db";
import type { SandboxBackupId } from "@mosoo/id";

import {
  disposeRpcResource,
  withDisposedRpcResult,
} from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../shared/shell";
import type { EnvironmentPackageArtifactBuildCommandPayload } from "../../api-command/application/api-command-payload";
import { isRuntimeSandboxLocalBucketEnabled } from "../../runtime/infrastructure/runtime-sandbox-bucket-mount";
import { getEphemeralUnversionedSandboxHandle } from "../../runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import { encodeSandboxBackupIdForStorage } from "../../runtime/infrastructure/sandbox-backup-id";
import { authorizeSandboxBackupDeletion } from "../../runtime/infrastructure/sandbox-backup-store";
import type { SandboxHandle } from "../../runtime/infrastructure/sandbox-handles";
import {
  createEnvironmentPackageArtifactKey,
  environmentPackageArtifactBuildSandboxId,
  environmentPackageArtifactDir,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
  ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS,
} from "../domain/environment-package-artifact";
import type { EnvironmentPackageArtifactPaths } from "../domain/environment-package-artifact";
import { normalizePackages } from "./environment-config";
import {
  createEnvironmentPackageArtifactBackupName,
  environmentPackageArtifactMetadataBackupId,
  isEnvironmentPackageArtifactBackupReady,
  publishEnvironmentPackageArtifactBackup,
  resolveEnvironmentPackageArtifactBackup,
} from "./environment-package-artifact-backup";
import {
  claimEnvironmentPackageArtifactBackupActual,
  clearMissingEnvironmentPackageArtifactBackupActual,
  completeEnvironmentPackageArtifactBackupStage,
  getEnvironmentPackageArtifactBackupStage,
  stageEnvironmentPackageArtifactBackup,
} from "./environment-package-artifact-backup-store";

const ENVIRONMENT_ARTIFACT_BUILD_SANDBOX_SLEEP_AFTER_SECONDS =
  ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS / 1_000 + 5 * 60;

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

export interface EnvironmentPackageArtifactBuildAuthority {
  readonly attemptCount: number;
  readonly claimOwner: string;
  readonly commandId: ApiCommandId;
  readonly deliveryGeneration: number;
  requireOwnership(): Promise<void>;
}

async function withBuildOwnership<T>(
  authority: EnvironmentPackageArtifactBuildAuthority,
  effect: () => Promise<T>,
): Promise<T> {
  await authority.requireOwnership();
  try {
    return await effect();
  } finally {
    await authority.requireOwnership();
  }
}

async function settlePublishedArtifact(
  bindings: ApiBindings,
  input: {
    readonly authority: EnvironmentPackageArtifactBuildAuthority;
    readonly commandId: ApiCommandId;
    readonly key: Awaited<ReturnType<typeof createEnvironmentPackageArtifactKey>>;
  },
): Promise<SandboxBackupId | null> {
  const metadata = await resolveEnvironmentPackageArtifactBackup(bindings, input.key);
  if (metadata === null) {
    return null;
  }
  const backupId = environmentPackageArtifactMetadataBackupId(metadata);
  if (backupId === null) {
    throw new Error("Environment package artifact metadata has an invalid backup ID.");
  }
  const stage = await getEnvironmentPackageArtifactBackupStage(bindings.DB, input.commandId);
  if (stage === null) {
    return backupId;
  }
  if (JSON.stringify(stage.paths) !== JSON.stringify(metadata.paths)) {
    throw new Error("Environment package artifact manifest changed its immutable paths.");
  }
  await withBuildOwnership(input.authority, () =>
    completeEnvironmentPackageArtifactBackupStage(bindings.DB, {
      actualBackupId: stage.actualBackupId,
      attemptCount: stage.attemptCount,
      claimOwner: stage.claimOwner,
      commandId: stage.commandId,
      deliveryGeneration: stage.deliveryGeneration,
    }),
  );
  return backupId;
}

async function publishClaimedArtifact(
  bindings: ApiBindings,
  input: {
    readonly attemptCount: number;
    readonly authority: EnvironmentPackageArtifactBuildAuthority;
    readonly backupId: SandboxBackupId;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
    readonly dir: string;
    readonly key: Awaited<ReturnType<typeof createEnvironmentPackageArtifactKey>>;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): Promise<void> {
  if (
    (await settlePublishedArtifact(bindings, {
      authority: input.authority,
      commandId: input.commandId,
      key: input.key,
    })) !== null
  ) {
    return;
  }
  if (!(await isEnvironmentPackageArtifactBackupReady(bindings, input))) {
    throw new Error("Environment package artifact backup objects are incomplete.");
  }
  await withBuildOwnership(input.authority, () =>
    publishEnvironmentPackageArtifactBackup(bindings, {
      attemptCount: input.attemptCount,
      backupId: input.backupId,
      claimOwner: input.authority.claimOwner,
      commandId: input.commandId,
      deliveryGeneration: input.deliveryGeneration,
      key: input.key,
      paths: input.paths,
    }),
  );
  if (
    (await settlePublishedArtifact(bindings, {
      authority: input.authority,
      commandId: input.commandId,
      key: input.key,
    })) === null
  ) {
    throw new Error("Environment package artifact manifest was not committed.");
  }
}

export async function buildEnvironmentPackageArtifact(
  bindings: ApiBindings,
  payload: EnvironmentPackageArtifactBuildCommandPayload,
  authority: EnvironmentPackageArtifactBuildAuthority,
): Promise<void> {
  const packages = normalizePackages(payload.packages);
  const key = await createEnvironmentPackageArtifactKey({
    projectId: payload.projectId,
    artifactAbi: payload.artifactAbi,
    packages,
  });
  if (key.inputDigest !== payload.inputDigest) {
    throw new Error("Environment package artifact digest does not match its payload.");
  }
  if (
    (await settlePublishedArtifact(bindings, {
      authority,
      commandId: authority.commandId,
      key,
    })) !== null
  ) {
    return;
  }

  const npmSpecs = packages.find(({ manager }) => manager === "npm")?.packages ?? [];
  const pipSpecs = packages.find(({ manager }) => manager === "pip")?.packages ?? [];
  const dir = environmentPackageArtifactDir(key);
  const tempRoot = `/tmp/mosoo-environment-artifact-${key.inputDigest}`;
  const npmRoot = `${dir}/npm`;
  const pipRoot = `${dir}/python`;
  const sandbox = await getEphemeralUnversionedSandboxHandle(
    bindings,
    environmentPackageArtifactBuildSandboxId(
      authority.commandId,
      authority.deliveryGeneration,
      authority.attemptCount,
    ),
    ENVIRONMENT_ARTIFACT_BUILD_SANDBOX_SLEEP_AFTER_SECONDS,
  );

  try {
    const reset = await withBuildOwnership(authority, () =>
      sandbox.exec(
        `rm -rf ${quoteShellArg(dir)} ${quoteShellArg(tempRoot)} && mkdir -p ${quoteShellArg(dir)} ${quoteShellArg(tempRoot)}`,
      ),
    );
    if (!reset.success) {
      throw new Error("Environment package build directory could not be prepared.");
    }
    const result = await withBuildOwnership(authority, () =>
      sandbox.exec(
        createEnvironmentPackageArtifactBuildScript({
          npmRoot,
          npmSpecs,
          pipRoot,
          pipSpecs,
          tempRoot,
        }),
        { timeout: ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS },
      ),
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
    let stage = await withBuildOwnership(authority, () =>
      stageEnvironmentPackageArtifactBackup(bindings.DB, {
        attemptCount: authority.attemptCount,
        claimOwner: authority.claimOwner,
        commandId: authority.commandId,
        deliveryGeneration: authority.deliveryGeneration,
        dir,
        key,
        paths,
      }),
    );
    if (
      stage.actualBackupId !== null &&
      !(await isEnvironmentPackageArtifactBackupReady(bindings, {
        attemptCount: authority.attemptCount,
        backupId: stage.actualBackupId,
        commandId: authority.commandId,
        deliveryGeneration: authority.deliveryGeneration,
        dir,
      }))
    ) {
      const cleared = await withBuildOwnership(authority, () =>
        clearMissingEnvironmentPackageArtifactBackupActual(bindings.DB, {
          actualBackupId: stage.actualBackupId as SandboxBackupId,
          attemptCount: stage.attemptCount,
          claimOwner: stage.claimOwner,
          commandId: stage.commandId,
          deliveryGeneration: stage.deliveryGeneration,
        }),
      );
      if (!cleared) {
        if (
          (await settlePublishedArtifact(bindings, {
            authority,
            commandId: authority.commandId,
            key,
          })) !== null
        ) {
          return;
        }
        throw new Error("Environment package artifact build lost its immutable stage.");
      }
      stage = { ...stage, actualBackupId: null };
    }
    if (stage.actualBackupId !== null) {
      const claimed = await withBuildOwnership(authority, () =>
        claimEnvironmentPackageArtifactBackupActual(bindings.DB, {
          actualBackupId: stage.actualBackupId as SandboxBackupId,
          authority,
          commandId: authority.commandId,
          dir,
        }),
      );
      if (claimed?.actualBackupId !== stage.actualBackupId) {
        if (
          (await settlePublishedArtifact(bindings, {
            authority,
            commandId: authority.commandId,
            key,
          })) !== null
        ) {
          return;
        }
        throw new Error("Environment package artifact build lost its API command lease.");
      }
      await publishClaimedArtifact(bindings, {
        attemptCount: authority.attemptCount,
        authority,
        backupId: stage.actualBackupId,
        commandId: authority.commandId,
        deliveryGeneration: authority.deliveryGeneration,
        dir,
        key,
        paths,
      });
      return;
    }

    const backup = await withBuildOwnership(authority, () =>
      withDisposedRpcResult(
        sandbox.createBackup({
          dir,
          localBucket: isRuntimeSandboxLocalBucketEnabled(bindings),
          name: createEnvironmentPackageArtifactBackupName(authority),
          ttl: ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
        }),
        (backupResult) => ({ dir: backupResult.dir, id: backupResult.id }),
      ),
    );
    if (!backup.id || backup.dir !== dir) {
      throw new Error("Environment package artifact backup is invalid.");
    }
    const candidateId = encodeSandboxBackupIdForStorage(backup.id);
    const claimed = await withBuildOwnership(authority, () =>
      claimEnvironmentPackageArtifactBackupActual(bindings.DB, {
        actualBackupId: candidateId,
        authority,
        commandId: authority.commandId,
        dir,
      }),
    );
    if (claimed?.actualBackupId !== candidateId) {
      const published = await settlePublishedArtifact(bindings, {
        authority,
        commandId: authority.commandId,
        key,
      });
      if (claimed !== null && (published === null || published !== candidateId)) {
        await withBuildOwnership(authority, () =>
          authorizeSandboxBackupDeletion(bindings.DB, {
            authority: {
              attemptCount: authority.attemptCount,
              commandId: authority.commandId,
              deliveryGeneration: authority.deliveryGeneration,
              kind: "environment_candidate",
            },
            backupId: candidateId,
          }),
        );
      }
      if (published !== null) {
        return;
      }
      if (claimed === null) {
        throw new Error("Environment package artifact build lost its API command lease.");
      }
      await publishClaimedArtifact(bindings, {
        attemptCount: authority.attemptCount,
        authority,
        backupId: claimed.actualBackupId,
        commandId: authority.commandId,
        deliveryGeneration: authority.deliveryGeneration,
        dir,
        key,
        paths,
      });
      return;
    }
    await publishClaimedArtifact(bindings, {
      attemptCount: authority.attemptCount,
      authority,
      backupId: candidateId,
      commandId: authority.commandId,
      deliveryGeneration: authority.deliveryGeneration,
      dir,
      key,
      paths,
    });
  } finally {
    await closeBuildSandbox(sandbox);
  }
}
