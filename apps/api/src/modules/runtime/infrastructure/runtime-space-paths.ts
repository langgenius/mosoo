import { normalizeSpaceFilePath } from "@mosoo/contracts/file";
import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import { readRuntimeSpaceMountPathOriginal } from "@mosoo/driver-protocol";
import type { RuntimeSpaceMountPath } from "@mosoo/driver-protocol";

export interface RuntimeSpacePathResolution {
  readonly relativePath: string;
  readonly spaceId: string;
}

export function isHiddenRuntimeSpacePath(path: string): boolean {
  return path
    .split("/")
    .filter(Boolean)
    .some((segment) => segment.startsWith("."));
}

export function readRuntimeSpaceMountPath(path: string): RuntimeSpaceMountPath {
  return readRuntimeSpaceMountPathOriginal(path);
}

function resolveRelativeRuntimeSpacePath(
  path: string,
  mountPath: RuntimeSpaceMountPath,
): string | null {
  if (path === mountPath) {
    return "";
  }

  if (!path.startsWith(`${mountPath}/`)) {
    return null;
  }

  const relativePath = path.slice(mountPath.length + 1);

  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    relativePath.includes("//")
  ) {
    throw new Error("Runtime Space file path must be normalized before sync.");
  }

  try {
    const normalized = normalizeSpaceFilePath(relativePath);
    if (normalized === relativePath) {
      return normalized;
    }
  } catch {
    throw new Error("Runtime Space file path must be normalized before sync.");
  }

  throw new Error("Runtime Space file path must be normalized before sync.");
}

export function resolveRuntimeSpacePath(
  aliases: readonly SpaceAliasBinding[],
  path: string,
): RuntimeSpacePathResolution | null {
  let match: SpaceAliasBinding | null = null;
  let matchPath: string | null = null;
  let matchRelativePath: string | null = null;

  for (const alias of aliases) {
    for (const candidate of [
      readRuntimeSpaceMountPath(alias.aliasPath),
      readRuntimeSpaceMountPath(alias.globalMountPath),
    ]) {
      const relativePath = resolveRelativeRuntimeSpacePath(path, candidate);

      if (relativePath !== null && (matchPath === null || candidate.length > matchPath.length)) {
        match = alias;
        matchPath = candidate;
        matchRelativePath = relativePath;
      }
    }
  }

  if (match === null || matchPath === null || matchRelativePath === null) {
    return null;
  }

  return {
    relativePath: matchRelativePath,
    spaceId: match.spaceId,
  };
}

function requireRuntimeSpaceFilePath(relativePath: string): string {
  try {
    const normalized = normalizeSpaceFilePath(relativePath);

    if (normalized === relativePath) {
      return normalized;
    }
  } catch {
    throw new Error("Runtime Space file path must be normalized before projection.");
  }

  throw new Error("Runtime Space file path must be normalized before projection.");
}

export function createRuntimeSpaceObjectKey(resolution: RuntimeSpacePathResolution): string {
  return `space/${resolution.spaceId}/${requireRuntimeSpaceFilePath(resolution.relativePath)}`;
}

export function getRuntimeSpaceFileName(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

export function joinRuntimeSandboxSpacePath(
  rootPath: string | RuntimeSpaceMountPath,
  relativePath: string,
): string {
  const mountPath = readRuntimeSpaceMountPath(rootPath);

  return `${mountPath}/${requireRuntimeSpaceFilePath(relativePath)}`;
}
