import type { EnvironmentPackageSpec } from "@mosoo/contracts/environment";
import type { AppId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { validationError } from "../../../platform/errors";
import {
  enqueueApiCommand,
  findApiCommandByDedupeKey,
} from "../../api-command/application/api-command-ledger";
import {
  createEnvironmentPackageArtifactKey,
  environmentPackageArtifactDir,
  environmentPackageArtifactMetadataKey,
  ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
} from "../domain/environment-package-artifact";
import type {
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactMetadata,
} from "../domain/environment-package-artifact";
import { normalizePackages, parsePackagesJson } from "./environment-config";

type ArtifactBindings = Pick<
  ApiBindings,
  "API_COMMAND_QUEUE" | "DB" | "ENVIRONMENT_ARTIFACT_BUILD_QUEUE" | "SANDBOX_STATE_BUCKET"
>;

export async function readEnvironmentPackageArtifactMetadata(
  bindings: Pick<ApiBindings, "SANDBOX_STATE_BUCKET">,
  key: EnvironmentPackageArtifactKey,
): Promise<EnvironmentPackageArtifactMetadata | null> {
  const object = await bindings.SANDBOX_STATE_BUCKET.get(
    environmentPackageArtifactMetadataKey(key),
  );
  if (object === null) {
    return null;
  }
  const metadata = JSON.parse(await object.text()) as Partial<EnvironmentPackageArtifactMetadata>;
  const paths = metadata.paths;
  if (
    typeof metadata.backupId !== "string" ||
    paths === undefined ||
    ![paths.executable, paths.node, paths.python].every(Array.isArray)
  ) {
    throw new Error("Environment package artifact metadata is invalid.");
  }
  return { backupId: metadata.backupId, paths };
}

export async function resolveEnvironmentPackageArtifact(
  bindings: ArtifactBindings,
  appId: AppId,
  packages: readonly EnvironmentPackageSpec[],
  options: { retryFailed?: boolean } = {},
): Promise<{
  key: EnvironmentPackageArtifactKey;
  metadata: EnvironmentPackageArtifactMetadata | null;
} | null> {
  if (!packages.some((entry) => entry.packages.length > 0)) {
    return null;
  }
  const normalized = normalizePackages(packages);
  const key = await createEnvironmentPackageArtifactKey({
    appId,
    artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
    packages: normalized,
  });
  const metadata = await readEnvironmentPackageArtifactMetadata(bindings, key);
  if (metadata === null) {
    const dedupeKey = `environment_package_artifact_build:${key.appId}:${key.inputDigest}`;
    await enqueueApiCommand(bindings, {
      dedupeKey,
      kind: "environment_package_artifact_build",
      retryTerminal: options.retryFailed === true,
      payload: {
        ...key,
        artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
        packages: normalized,
      },
    });
    if (options.retryFailed !== true) {
      const command = await findApiCommandByDedupeKey(bindings.DB, dedupeKey);
      if (command !== null && command.status !== "queued" && command.status !== "running") {
        const completedMetadata = await readEnvironmentPackageArtifactMetadata(bindings, key);
        if (completedMetadata !== null) {
          return { key, metadata: completedMetadata };
        }
        throw validationError(
          command.lastErrorMessage?.trim() ||
            "Environment package artifact is unavailable. Save the Environment to retry.",
          "ENVIRONMENT_ARTIFACT_FAILED",
        );
      }
    }
  }
  return { key, metadata };
}

export async function resolveReadyEnvironmentPackageArtifact(
  bindings: ArtifactBindings,
  appId: AppId,
  packagesJson: string,
): Promise<
  | (EnvironmentPackageArtifactMetadata & {
      backupDir: string;
    })
  | null
> {
  const artifact = await resolveEnvironmentPackageArtifact(
    bindings,
    appId,
    parsePackagesJson(packagesJson),
  );
  if (artifact === null) {
    return null;
  }
  if (artifact.metadata === null) {
    throw validationError(
      "Environment packages are being prepared. Try again shortly.",
      "ENVIRONMENT_ARTIFACT_PREPARING",
    );
  }
  return {
    ...artifact.metadata,
    backupDir: environmentPackageArtifactDir(artifact.key),
  };
}
