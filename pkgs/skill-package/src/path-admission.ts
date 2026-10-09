import { SkillPackageError } from "./errors";

export type SkillPackagePathKind = "directory" | "file";

export const SKILL_PACKAGE_MANIFEST_PATH = "SKILL.md";

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

export function inferSkillPackagePathKind(path: string): SkillPackagePathKind {
  return path.endsWith("/") || path.endsWith("\\") ? "directory" : "file";
}

export function admitSkillPackagePath(path: string, entryKind: SkillPackagePathKind): string {
  if (isAbsolutePath(path) || hasUnsafePathCharacter(path)) {
    throw new SkillPackageError(`The skill package contains an invalid path: ${path}`);
  }

  const normalizedSeparators = path.replaceAll("\\", "/");
  const segments = (
    entryKind === "directory" && normalizedSeparators.endsWith("/")
      ? normalizedSeparators.slice(0, -1)
      : normalizedSeparators
  ).split("/");

  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new SkillPackageError(`The skill package contains an invalid path: ${path}`);
    }

    if (isReservedPathSegment(segment)) {
      throw new SkillPackageError(`The skill package path uses a reserved key: ${segment}`);
    }
  }

  return segments.join("/");
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

function isReservedPathSegment(segment: string): boolean {
  const lowercase = segment.toLowerCase();

  return (
    RESERVED_PATH_KEYS.has(lowercase) ||
    RESERVED_PATH_KEYS.has(lowercase.replaceAll("_", "-")) ||
    lowercase.startsWith(".") ||
    lowercase.endsWith(".key") ||
    lowercase.endsWith(".pem")
  );
}
