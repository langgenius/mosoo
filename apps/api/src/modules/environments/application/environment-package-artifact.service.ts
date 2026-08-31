import type { EnvironmentPackageSpec } from "@mosoo/contracts/environment";
import type { ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { validationError } from "../../../platform/errors";
import {
  enqueueApiCommand,
  findApiCommandByDedupeKey,
} from "../../api-command/application/api-command-ledger";
import {
  createEnvironmentPackageArtifactKey,
  environmentPackageArtifactDir,
  ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
} from "../domain/environment-package-artifact";
import type {
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactMetadata,
} from "../domain/environment-package-artifact";
import { normalizePackages, parsePackagesJson } from "./environment-config";
import { resolveEnvironmentPackageArtifactBackup } from "./environment-package-artifact-backup";
import { getEnvironmentPackageArtifactBackupManifest } from "./environment-package-artifact-backup-store";

type ArtifactBindings = Pick<
  ApiBindings,
  "API_COMMAND_QUEUE" | "DB" | "ENVIRONMENT_ARTIFACT_BUILD_QUEUE" | "SANDBOX_STATE_BUCKET"
>;

export async function resolveEnvironmentPackageArtifact(
  bindings: ArtifactBindings,
  projectId: ProjectId,
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
    projectId,
    artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
    packages: normalized,
  });
  const metadata = await resolveEnvironmentPackageArtifactBackup(bindings, key);
  if (metadata === null) {
    const refreshCurrentManifest =
      (await getEnvironmentPackageArtifactBackupManifest(bindings.DB, key)) !== null;
    const dedupeKey = `environment_package_artifact_build:${key.projectId}:${key.inputDigest}`;
    const existingCommand = await findApiCommandByDedupeKey(bindings.DB, dedupeKey);
    await enqueueApiCommand(bindings, {
      dedupeKey,
      kind: "environment_package_artifact_build",
      retryTerminal:
        refreshCurrentManifest ||
        existingCommand?.status === "succeeded" ||
        options.retryFailed === true,
      payload: {
        ...key,
        artifactAbi: ENVIRONMENT_PACKAGE_ARTIFACT_ABI,
        packages: normalized,
      },
    });
    if (options.retryFailed !== true) {
      const command = await findApiCommandByDedupeKey(bindings.DB, dedupeKey);
      if (command !== null && command.status !== "queued" && command.status !== "running") {
        const completedMetadata = await resolveEnvironmentPackageArtifactBackup(bindings, key);
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
  projectId: ProjectId,
  packagesJson: string,
): Promise<
  | (EnvironmentPackageArtifactMetadata & {
      backupDir: string;
    })
  | null
> {
  const artifact = await resolveEnvironmentPackageArtifact(
    bindings,
    projectId,
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
