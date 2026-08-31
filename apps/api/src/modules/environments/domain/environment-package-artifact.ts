import type { EnvironmentPackageSpec } from "@mosoo/contracts/environment";
import type { ProjectId } from "@mosoo/id";

export const ENVIRONMENT_PACKAGE_ARTIFACT_ABI = "environment-artifact-v1";
export const ENVIRONMENT_PACKAGE_ARTIFACT_MAX_BUILD_MS = 10 * 60 * 1000;
export const ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;
export const ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1_000;
const ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_NAME_PREFIX = "mosoo:environment-artifact:v1:";

export interface EnvironmentPackageArtifactPaths {
  executable: string[];
  node: string[];
  python: string[];
}

export interface EnvironmentPackageArtifactKey {
  projectId: ProjectId;
  inputDigest: string;
}

export interface EnvironmentPackageArtifactMetadata {
  backupId: string;
  paths: EnvironmentPackageArtifactPaths;
}

export interface EnvironmentPackageArtifactBackupAuthorityRef {
  readonly attemptCount: number;
  readonly commandId: string;
  readonly deliveryGeneration: number;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parseArtifactPathArray(
  value: unknown,
  artifactDir: string,
  seen: Set<string>,
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const path of value) {
    if (
      typeof path !== "string" ||
      path.includes("\0") ||
      path.includes(":") ||
      !path.startsWith(`${artifactDir}/`) ||
      path
        .slice(artifactDir.length + 1)
        .split("/")
        .some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
      seen.has(path)
    ) {
      return null;
    }
    seen.add(path);
  }
  return value;
}

export function parseEnvironmentPackageArtifactPaths(
  value: unknown,
  artifactDir: string,
): EnvironmentPackageArtifactPaths | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).toSorted().join(",") !== "executable,node,python"
  ) {
    return null;
  }
  const seen = new Set<string>();
  const executable = parseArtifactPathArray(Reflect.get(value, "executable"), artifactDir, seen);
  const node = parseArtifactPathArray(Reflect.get(value, "node"), artifactDir, seen);
  const python = parseArtifactPathArray(Reflect.get(value, "python"), artifactDir, seen);
  return executable === null || node === null || python === null
    ? null
    : { executable, node, python };
}

export function parseEnvironmentPackageArtifactMetadata(
  value: unknown,
  artifactDir: string,
): EnvironmentPackageArtifactMetadata | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).toSorted().join(",") !== "backupId,paths"
  ) {
    return null;
  }
  const backupId = Reflect.get(value, "backupId");
  const paths = parseEnvironmentPackageArtifactPaths(Reflect.get(value, "paths"), artifactDir);
  return typeof backupId === "string" && backupId.length > 0 && paths !== null
    ? { backupId, paths }
    : null;
}

export function createEnvironmentPackageArtifactBackupName(
  authority: EnvironmentPackageArtifactBackupAuthorityRef,
): string {
  if (
    authority.commandId.length === 0 ||
    !isPositiveSafeInteger(authority.deliveryGeneration) ||
    !isPositiveSafeInteger(authority.attemptCount)
  ) {
    throw new Error("Environment package artifact command ID is required.");
  }
  return `${ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_NAME_PREFIX}${authority.commandId}:${authority.deliveryGeneration}:${authority.attemptCount}`;
}

export function parseEnvironmentPackageArtifactBackupName(
  value: string | null,
): EnvironmentPackageArtifactBackupAuthorityRef | null {
  if (value === null || !value.startsWith(ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_NAME_PREFIX)) {
    return null;
  }
  const [commandId, deliveryGenerationValue, attemptCountValue, extra] = value
    .slice(ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_NAME_PREFIX.length)
    .split(":");
  const deliveryGeneration = Number(deliveryGenerationValue);
  const attemptCount = Number(attemptCountValue);
  return commandId !== undefined &&
    commandId.length > 0 &&
    extra === undefined &&
    /^\d+$/u.test(deliveryGenerationValue ?? "") &&
    /^\d+$/u.test(attemptCountValue ?? "") &&
    isPositiveSafeInteger(deliveryGeneration) &&
    isPositiveSafeInteger(attemptCount)
    ? { attemptCount, commandId, deliveryGeneration }
    : null;
}

export async function createEnvironmentPackageArtifactKey(input: {
  projectId: ProjectId;
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
  return { projectId: input.projectId, inputDigest: new Uint8Array(digest).toHex() };
}

export function environmentPackageArtifactDir(key: EnvironmentPackageArtifactKey): string {
  return `/workspace/.mosoo/environment-artifacts/${key.inputDigest}`;
}

export function environmentPackageArtifactMetadataKey(key: EnvironmentPackageArtifactKey): string {
  return `environment-artifacts/${key.projectId}/${key.inputDigest}.json`;
}

export function environmentPackageArtifactBuildSandboxId(
  commandId: string,
  deliveryGeneration: number,
  attemptCount: number,
): string {
  if (
    commandId.length === 0 ||
    !isPositiveSafeInteger(deliveryGeneration) ||
    !isPositiveSafeInteger(attemptCount)
  ) {
    throw new Error("Environment package artifact attempt must be a positive safe integer.");
  }
  return `envpkg-${commandId}-${deliveryGeneration.toString(36)}-${attemptCount.toString(36)}`.toLowerCase();
}
