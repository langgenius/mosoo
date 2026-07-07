import { SkillPackageError } from "./errors";

export type SkillPackagePathKind = "directory" | "file";

export interface AdmittedSkillPackagePath {
  entryKind: SkillPackagePathKind;
  path: string;
}

export interface SkillPackagePathAdmission {
  admit(path: string, entryKind: SkillPackagePathKind): AdmittedSkillPackagePath;
}

export const SKILL_PACKAGE_MANIFEST_PATH = "SKILL.md";

const EMPTY_ALLOWED_RESERVED_PATHS: ReadonlySet<string> = new Set();

const RESERVED_PATH_KEYS = new Set([
  "__proto__",
  "constructor",
  "credential",
  "credentials",
  "private",
  "prototype",
  "provenance",
  "runtime-state",
  "secret",
  "secrets",
  "session",
  "sessions",
  "token",
  "tokens",
  "vault",
]);

export function createSkillPackagePathAdmission(
  allowedReservedPaths: ReadonlySet<string> = EMPTY_ALLOWED_RESERVED_PATHS,
): SkillPackagePathAdmission {
  const entries = new Map<string, SkillPackagePathKind>();

  return {
    admit(path, entryKind) {
      const admitted = admitSkillPackagePath(path, entryKind, allowedReservedPaths);
      rejectDuplicateOrCollision(entries, admitted.path, admitted.entryKind);
      entries.set(admitted.path, admitted.entryKind);

      return admitted;
    },
  };
}

export function createSkillPackageArchivePathAdmission(): SkillPackagePathAdmission {
  const entries = new Map<string, SkillPackagePathKind>();

  return {
    admit(path, entryKind) {
      const admitted = admitSkillPackageArchivePath(path, entryKind);
      rejectDuplicateOrCollision(entries, admitted.path, admitted.entryKind);
      entries.set(admitted.path, admitted.entryKind);

      return admitted;
    },
  };
}

export function admitSkillPackagePath(
  path: string,
  entryKind: SkillPackagePathKind = inferSkillPackagePathKind(path),
  allowedReservedPaths: ReadonlySet<string> = EMPTY_ALLOWED_RESERVED_PATHS,
): AdmittedSkillPackagePath {
  if (path.length === 0) {
    throw new SkillPackageError("The skill package contains an empty path.");
  }

  if (isAbsolutePath(path) || hasUnsafePathCharacter(path)) {
    throw new SkillPackageError(`The skill package contains an invalid path: ${path}`);
  }

  const segments = readPathSegments(path, entryKind);

  if (segments.length === 0) {
    throw new SkillPackageError("The skill package contains an empty path.");
  }

  const normalizedPath = segments.join("/");
  // Callers that own their own path admission (the agent package export/import
  // round trip) may exempt a fixed set of otherwise-reserved sidecar paths such
  // as `.mcp.json` from the reserved-key rule; skill packages pass no
  // exemptions, so the reserved-key rule still applies to every segment.
  const reservedExempt = allowedReservedPaths.has(normalizedPath);

  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new SkillPackageError(`The skill package contains an invalid path: ${path}`);
    }

    if (reservedExempt) {
      continue;
    }

    const reservedKey = readReservedPathKey(segment);

    if (reservedKey !== null) {
      throw new SkillPackageError(`The skill package path uses a reserved key: ${reservedKey}`);
    }
  }

  return {
    entryKind,
    path: normalizedPath,
  };
}

export function admitSkillPackageArchivePath(
  path: string,
  entryKind: SkillPackagePathKind = inferSkillPackagePathKind(path),
): AdmittedSkillPackagePath {
  const admitted = admitSkillPackagePath(path, entryKind);

  rejectUnsupportedArchivePath(admitted);

  return admitted;
}

function inferSkillPackagePathKind(path: string): SkillPackagePathKind {
  return path.endsWith("/") || path.endsWith("\\") ? "directory" : "file";
}

function readPathSegments(path: string, entryKind: SkillPackagePathKind): string[] {
  const normalizedSeparators = path.replaceAll("\\", "/");
  const segmentSource =
    entryKind === "directory" && normalizedSeparators.endsWith("/")
      ? normalizedSeparators.slice(0, -1)
      : normalizedSeparators;

  return segmentSource.split("/");
}

function rejectDuplicateOrCollision(
  entries: Map<string, SkillPackagePathKind>,
  path: string,
  entryKind: SkillPackagePathKind,
): void {
  if (entries.has(path)) {
    throw new SkillPackageError(
      `The skill package contains a duplicate path after normalization: ${path}`,
    );
  }

  if (entryKind === "file" && hasDescendant(entries, path)) {
    throw new SkillPackageError(
      `The skill package contains both a file and child path under: ${path}`,
    );
  }

  for (const ancestor of readAncestorPaths(path)) {
    if (entries.get(ancestor) === "file") {
      throw new SkillPackageError(
        `The skill package contains both a file and child path under: ${ancestor}`,
      );
    }
  }
}

function hasDescendant(entries: Map<string, SkillPackagePathKind>, path: string): boolean {
  const prefix = `${path}/`;

  for (const admittedPath of entries.keys()) {
    if (admittedPath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function readAncestorPaths(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }

  return ancestors;
}

function rejectUnsupportedArchivePath(admitted: AdmittedSkillPackagePath): void {
  if (admitted.path === SKILL_PACKAGE_MANIFEST_PATH) {
    if (admitted.entryKind !== "file") {
      throw new SkillPackageError(
        `The skill package manifest path must be a file: ${SKILL_PACKAGE_MANIFEST_PATH}`,
      );
    }

    return;
  }

  if (admitted.path.startsWith(`${SKILL_PACKAGE_MANIFEST_PATH}/`)) {
    throw new SkillPackageError(
      `The skill package manifest path cannot contain child entries: ${admitted.path}`,
    );
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path);
}

function hasUnsafePathCharacter(path: string): boolean {
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f || code === 0xfffd) {
      return true;
    }
  }

  return false;
}

function readReservedPathKey(segment: string): string | null {
  const normalized = segment.toLowerCase().replaceAll("_", "-");

  if (
    RESERVED_PATH_KEYS.has(normalized) ||
    normalized.startsWith(".") ||
    normalized.startsWith(".env") ||
    normalized.startsWith(".state") ||
    normalized.endsWith(".key") ||
    normalized.endsWith(".pem")
  ) {
    return segment;
  }

  return null;
}
