import { SESSION_RESOURCE_MOUNT_DIR } from "@mosoo/contracts/file";

export const SANDBOX_ORGANIZATION_ROOT = "/organization";
export const SANDBOX_WORKSPACE_ROOT = "/workspace";
export const SANDBOX_CACHE_PATH = `${SANDBOX_WORKSPACE_ROOT}/cache`;
export const SANDBOX_GLOBAL_SPACE_ROOT = "/organization/sp";
export const SANDBOX_MEMORY_PATH = `${SANDBOX_WORKSPACE_ROOT}/memory`;
export const SANDBOX_SESSION_STATE_DIR = ".state";
export const SANDBOX_SESSION_ROOT = `${SANDBOX_WORKSPACE_ROOT}/se`;

export type SandboxFileBrowserPathPurpose = "content" | "tree";

declare const RuntimeSpaceMountPathBrand: unique symbol;

export type RuntimeSpaceMountPath = string & {
  readonly [RuntimeSpaceMountPathBrand]: true;
};

export function getSessionWorkspacePath(sessionId: string): string {
  return `${SANDBOX_SESSION_ROOT}/${sessionId}`;
}

export function getSessionOrganizationPath(sessionId: string): string {
  return getSessionWorkspacePath(sessionId);
}

export function getSessionSpaceRootPath(sessionId: string): string {
  return `${getSessionWorkspacePath(sessionId)}/space`;
}

export function getSessionStateRootPath(sessionId: string): string {
  return `${getSessionWorkspacePath(sessionId)}/${SANDBOX_SESSION_STATE_DIR}`;
}

export function getSessionResourceRootPath(sessionId: string): string {
  return `${getSessionWorkspacePath(sessionId)}/${SESSION_RESOURCE_MOUNT_DIR}`;
}

export function getSessionRuntimeStatePath(sessionId: string, runtimeId: string): string {
  return `${getSessionStateRootPath(sessionId)}/${runtimeId}`;
}

export function getGlobalSpaceMountPath(spaceId: string): string {
  return `${SANDBOX_GLOBAL_SPACE_ROOT}/${spaceId}`;
}

export function getSessionAliasPath(sessionId: string, spaceName: string): string {
  return `${getSessionSpaceRootPath(sessionId)}/${spaceName}`;
}

function hasConcreteChildPath(path: string, rootPath: string): boolean {
  return path.startsWith(`${rootPath}/`) && path.length > rootPath.length + 1;
}

export function isSandboxOrganizationPath(path: string): boolean {
  return path === SANDBOX_ORGANIZATION_ROOT || path.startsWith(`${SANDBOX_ORGANIZATION_ROOT}/`);
}

export function isSandboxCachePath(path: string): boolean {
  return path === SANDBOX_CACHE_PATH || path.startsWith(`${SANDBOX_CACHE_PATH}/`);
}

export function isSandboxMemoryPath(path: string): boolean {
  return path === SANDBOX_MEMORY_PATH || path.startsWith(`${SANDBOX_MEMORY_PATH}/`);
}

export function isSandboxGlobalSpacePath(path: string): boolean {
  return hasConcreteChildPath(path, SANDBOX_GLOBAL_SPACE_ROOT);
}

export function isSandboxSessionPath(path: string): boolean {
  return hasConcreteChildPath(path, SANDBOX_SESSION_ROOT);
}

export function isSandboxSessionStatePath(path: string): boolean {
  if (!isSandboxSessionPath(path)) {
    return false;
  }

  const [sessionId, stateSegment] = path.slice(SANDBOX_SESSION_ROOT.length + 1).split("/");

  return (
    sessionId !== undefined && sessionId.length > 0 && stateSegment === SANDBOX_SESSION_STATE_DIR
  );
}

export function isSandboxSessionAliasPath(path: string): boolean {
  if (!isSandboxSessionPath(path)) {
    return false;
  }

  const [sessionId, spaceSegment, spaceName] = path
    .slice(SANDBOX_SESSION_ROOT.length + 1)
    .split("/");

  return (
    sessionId !== undefined &&
    sessionId.length > 0 &&
    spaceSegment === "space" &&
    spaceName !== undefined &&
    spaceName.length > 0
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
}

function readSandboxAbsolutePathOriginal(input: {
  emptyPath?: string;
  ownerLabel: string;
  rawPath: string;
}): string {
  const path =
    input.rawPath.length === 0 && input.emptyPath !== undefined ? input.emptyPath : input.rawPath;

  if (!path.startsWith("/")) {
    throw new Error(`${input.ownerLabel} must be absolute.`);
  }

  if (hasControlCharacter(path)) {
    throw new Error(`${input.ownerLabel} must not contain control characters.`);
  }

  if (path.includes("\\")) {
    throw new Error(`${input.ownerLabel} must use '/' separators.`);
  }

  if (path.length > 1 && path.endsWith("/")) {
    throw new Error(`${input.ownerLabel} must not end with a separator.`);
  }

  if (path.includes("//")) {
    throw new Error(`${input.ownerLabel} must not contain empty segments.`);
  }

  const segments = path.split("/");

  if (segments.includes(".")) {
    throw new Error(`${input.ownerLabel} must not contain current segments.`);
  }

  if (segments.includes("..")) {
    throw new Error(`${input.ownerLabel} must not contain traversal segments.`);
  }

  return path;
}

function readSandboxFileBrowserPathOriginal(rawPath: string): string {
  return readSandboxAbsolutePathOriginal({
    emptyPath: "/",
    ownerLabel: "Sandbox browser path",
    rawPath,
  });
}

export function readRuntimeSpaceMountPathOriginal(rawPath: string): RuntimeSpaceMountPath {
  const path = readSandboxAbsolutePathOriginal({
    ownerLabel: "Runtime Space mount path",
    rawPath,
  });

  if (path === "/") {
    throw new Error("Runtime Space mount path must not be the sandbox root.");
  }

  return path as RuntimeSpaceMountPath;
}

function isAllowedSandboxFileBrowserPath(path: string): boolean {
  return (
    path === "/" ||
    path === SANDBOX_WORKSPACE_ROOT ||
    path === SANDBOX_MEMORY_PATH ||
    path.startsWith(`${SANDBOX_MEMORY_PATH}/`) ||
    path === SANDBOX_SESSION_ROOT ||
    path.startsWith(`${SANDBOX_SESSION_ROOT}/`) ||
    path === SANDBOX_ORGANIZATION_ROOT ||
    path === SANDBOX_GLOBAL_SPACE_ROOT ||
    path.startsWith(`${SANDBOX_GLOBAL_SPACE_ROOT}/`)
  );
}

function isSandboxSessionSpaceAliasPath(path: string): boolean {
  if (isSandboxSessionAliasPath(path)) {
    return true;
  }

  if (!path.startsWith(`${SANDBOX_SESSION_ROOT}/`)) {
    return false;
  }

  const [sessionId, segment] = path.slice(SANDBOX_SESSION_ROOT.length + 1).split("/");
  return sessionId !== undefined && sessionId.length > 0 && segment === "space";
}

export function normalizeSandboxFileBrowserPath(
  rawPath: string,
  purpose: SandboxFileBrowserPathPurpose,
): string {
  const path = readSandboxFileBrowserPathOriginal(rawPath);

  if (isSandboxCachePath(path)) {
    throw new Error("Sandbox cache is not visible in the Agent File Browser.");
  }

  if (isSandboxSessionStatePath(path)) {
    throw new Error("Session runtime state is not visible in the Agent File Browser.");
  }

  if (isSandboxSessionSpaceAliasPath(path)) {
    throw new Error("Space files open in the Space page.");
  }

  const isSpacePath = path.startsWith(`${SANDBOX_GLOBAL_SPACE_ROOT}/`);
  const spacePathDepth = isSpacePath ? path.split("/").filter(Boolean).length : 0;

  if (purpose === "content" && isSpacePath) {
    throw new Error("Space files open in the Space page.");
  }

  if (purpose === "tree" && spacePathDepth > 3) {
    throw new Error("Space files open in the Space page.");
  }

  if (!isAllowedSandboxFileBrowserPath(path)) {
    throw new Error("Sandbox browser path is outside the Agent home.");
  }

  return path;
}
