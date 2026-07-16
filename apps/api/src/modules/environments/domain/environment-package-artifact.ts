import type { EnvironmentPackageSpec } from "@mosoo/contracts/environment";
import type { AppId } from "@mosoo/id";

export const ENVIRONMENT_PACKAGE_ARTIFACT_ROOT = "/workspace/.mosoo/environment-artifacts";
export const ENVIRONMENT_PACKAGE_ARTIFACT_ABI = "environment-artifact-v1";
export const ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS = 10 * 60 * 1000;
export const ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface EnvironmentPackageArtifactPaths {
  executable: string[];
  node: string[];
  python: string[];
}

export interface EnvironmentPackageArtifactKey {
  appId: AppId;
  inputDigest: string;
}

export interface EnvironmentPackageArtifactMetadata {
  backupId: string;
  paths: EnvironmentPackageArtifactPaths;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createEnvironmentPackageArtifactKey(input: {
  appId: AppId;
  artifactAbi: string;
  packages: readonly EnvironmentPackageSpec[];
}): Promise<EnvironmentPackageArtifactKey> {
  const artifactAbi = input.artifactAbi.trim();
  if (!artifactAbi) {
    throw new Error("Environment package artifact ABI is required.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ artifactAbi, packages: input.packages })),
  );
  return { appId: input.appId, inputDigest: bytesToHex(new Uint8Array(digest)) };
}

export function environmentPackageArtifactDir(key: EnvironmentPackageArtifactKey): string {
  return `${ENVIRONMENT_PACKAGE_ARTIFACT_ROOT}/${key.inputDigest}`;
}

export function environmentPackageArtifactMetadataKey(key: EnvironmentPackageArtifactKey): string {
  return `environment-artifacts/${key.appId}/${key.inputDigest}.json`;
}

export function environmentPackageArtifactSandboxId(key: EnvironmentPackageArtifactKey): string {
  return `envpkg-${key.appId}-${key.inputDigest}`.toLowerCase().slice(0, 63);
}
