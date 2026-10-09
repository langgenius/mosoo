import { SkillPackageError } from "./errors";
import { parseSkillMarkdown } from "./frontmatter";
import type { SkillFrontmatter } from "./frontmatter";
import {
  admitSkillPackagePath,
  inferSkillPackagePathKind,
  SKILL_PACKAGE_MANIFEST_PATH,
} from "./path-admission";

export type SkillEntryKind = "directory" | "file";

export interface SkillPackageEntry {
  body: Uint8Array;
  entryKind: SkillEntryKind;
  isExecutable: boolean;
  path: string;
}

export interface NormalizedSkillPackage {
  entries: SkillPackageEntry[];
  frontmatter: SkillFrontmatter;
  skillMarkdownPath: string;
}

export function createMarkdownSkillPackage(markdown: string): NormalizedSkillPackage {
  return normalizeSkillEntries({
    [SKILL_PACKAGE_MANIFEST_PATH]: {
      body: new TextEncoder().encode(markdown),
      entryKind: "file",
      isExecutable: false,
    },
  });
}

export function normalizeSkillEntries(
  rawEntries: Record<
    string,
    {
      body: Uint8Array;
      entryKind?: SkillEntryKind;
      isExecutable?: boolean;
    }
  >,
): NormalizedSkillPackage {
  const admitted = new Map<string, SkillPackageEntry>();

  for (const [inputPath, entry] of Object.entries(rawEntries)) {
    const entryKind = entry.entryKind ?? inferSkillPackagePathKind(inputPath);
    const path = admitSkillPackagePath(inputPath, entryKind);

    if (admitted.has(path)) {
      throw new SkillPackageError(
        `The skill package contains a duplicate path after normalization: ${path}`,
      );
    }

    admitted.set(path, {
      body: entryKind === "directory" ? new Uint8Array() : entry.body,
      entryKind,
      isExecutable: entryKind === "file" && (entry.isExecutable ?? false),
      path,
    });
  }

  if (admitted.size === 0) {
    throw new SkillPackageError("The skill package is empty.");
  }

  for (const path of admitted.keys()) {
    ensureParentDirectories(admitted, path);
  }

  const wrapper = detectSingleWrapper([...admitted.keys()]);
  const normalized = new Map<string, SkillPackageEntry>();

  for (const entry of admitted.values()) {
    const path = wrapper === null ? entry.path : entry.path.slice(wrapper.length + 1);

    if (path) {
      normalized.set(path, { ...entry, path });
    }
  }

  const skillMarkdownEntry = normalized.get(SKILL_PACKAGE_MANIFEST_PATH);

  if (skillMarkdownEntry?.entryKind !== "file") {
    throw new SkillPackageError("The normalized skill package root must contain SKILL.md.");
  }

  const { frontmatter } = parseSkillMarkdown(decodeSkillMarkdown(skillMarkdownEntry.body));

  return {
    entries: [...normalized.values()].toSorted((left, right) =>
      left.path.localeCompare(right.path),
    ),
    frontmatter,
    skillMarkdownPath: SKILL_PACKAGE_MANIFEST_PATH,
  };
}

export function toEntryRecord(entries: SkillPackageEntry[]): Record<string, SkillPackageEntry> {
  return Object.fromEntries(entries.map((entry) => [entry.path, entry]));
}

function decodeSkillMarkdown(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new SkillPackageError(
      error instanceof Error ? error.message : "SKILL.md must be valid UTF-8.",
    );
  }
}

function detectSingleWrapper(paths: readonly string[]): string | null {
  const topLevelNames = new Set(paths.map((path) => path.split("/", 1)[0]));

  if (topLevelNames.size !== 1) {
    return null;
  }

  const [wrapper] = topLevelNames;

  return wrapper !== undefined && paths.includes(`${wrapper}/${SKILL_PACKAGE_MANIFEST_PATH}`)
    ? wrapper
    : null;
}

function ensureParentDirectories(entries: Map<string, SkillPackageEntry>, path: string): void {
  const segments = path.split("/");

  for (let index = 1; index < segments.length; index += 1) {
    const directoryPath = segments.slice(0, index).join("/");
    const existing = entries.get(directoryPath);

    if (existing !== undefined) {
      if (existing.entryKind !== "directory") {
        throw new SkillPackageError(
          `The skill package contains both a file and child path under: ${directoryPath}`,
        );
      }
      continue;
    }

    entries.set(directoryPath, {
      body: new Uint8Array(),
      entryKind: "directory",
      isExecutable: false,
      path: directoryPath,
    });
  }
}
