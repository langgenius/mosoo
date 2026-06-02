import { SkillPackageError } from "./errors";
import { parseSkillMarkdown } from "./frontmatter";
import type { SkillFrontmatter } from "./frontmatter";
import {
  admitSkillPackageArchivePath as admitSkillPackageArchivePathValue,
  createSkillPackageArchivePathAdmission,
  createSkillPackagePathAdmission,
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
  const inputAdmission = createSkillPackagePathAdmission();
  const normalizedInput = Object.entries(rawEntries).map(([inputPath, entry]) => {
    const entryKind = entry.entryKind ?? inferEntryKind(inputPath, entry.body);

    return {
      body: entry.body,
      entryKind,
      isExecutable: entry.isExecutable ?? false,
      path: inputAdmission.admit(inputPath, entryKind).path,
    };
  });

  if (normalizedInput.length === 0) {
    throw new SkillPackageError("The skill package is empty.");
  }

  const wrapper = detectSingleWrapper(normalizedInput.map((entry) => entry.path));
  const outputAdmission = createSkillPackageArchivePathAdmission();
  const admittedEntries: SkillPackageEntry[] = [];

  for (const entry of normalizedInput) {
    const path = wrapper === null ? entry.path : stripWrapper(entry.path, wrapper);

    if (!path) {
      continue;
    }

    const normalizedPath = outputAdmission.admit(path, entry.entryKind).path;

    if (entry.entryKind === "directory") {
      admittedEntries.push({
        body: new Uint8Array(),
        entryKind: "directory",
        isExecutable: false,
        path: normalizedPath,
      });
      continue;
    }

    admittedEntries.push({
      body: entry.body,
      entryKind: "file",
      isExecutable: entry.isExecutable,
      path: normalizedPath,
    });
  }

  const normalized = new Map<string, SkillPackageEntry>(
    admittedEntries.map((entry) => [entry.path, entry] as const),
  );

  for (const entry of admittedEntries) {
    if (entry.entryKind === "file") {
      ensureParentDirectories(normalized, entry.path);
    }
  }

  const skillMarkdownEntry = normalized.get(SKILL_PACKAGE_MANIFEST_PATH);

  if (skillMarkdownEntry?.entryKind !== "file") {
    throw new SkillPackageError("The normalized skill package root must contain SKILL.md.");
  }

  const rawMarkdown = decodeSkillMarkdown(skillMarkdownEntry.body);
  const { frontmatter } = parseSkillMarkdown(rawMarkdown);

  const entries = [...normalized.values()].toSorted((left, right) => {
    if (left.path === right.path) {
      return 0;
    }

    return left.path.localeCompare(right.path);
  });

  return {
    entries,
    frontmatter,
    skillMarkdownPath: SKILL_PACKAGE_MANIFEST_PATH,
  };
}

export function toEntryRecord(entries: SkillPackageEntry[]): Record<
  string,
  {
    body: Uint8Array;
    entryKind: SkillEntryKind;
    isExecutable: boolean;
  }
> {
  const record: Record<
    string,
    {
      body: Uint8Array;
      entryKind: SkillEntryKind;
      isExecutable: boolean;
    }
  > = {};
  const admission = createSkillPackageArchivePathAdmission();

  for (const entry of entries) {
    const admittedPath = admission.admit(entry.path, entry.entryKind).path;

    record[admittedPath] = {
      body: entry.body,
      entryKind: entry.entryKind,
      isExecutable: entry.isExecutable,
    };
  }

  return record;
}

function inferEntryKind(path: string, _body: Uint8Array): SkillEntryKind {
  if (path.endsWith("/") || path.endsWith("\\")) {
    return "directory";
  }

  return "file";
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

function detectSingleWrapper(paths: string[]): string | null {
  const topLevelDirectories = new Set<string>();

  for (const path of paths) {
    const [firstSegment] = path.split("/");

    if (firstSegment === undefined || firstSegment.length === 0) {
      continue;
    }

    topLevelDirectories.add(firstSegment);
  }

  if (topLevelDirectories.size !== 1) {
    return null;
  }

  const [wrapper] = [...topLevelDirectories];

  if (wrapper === undefined || wrapper.length === 0) {
    return null;
  }

  const hasNestedSkillMarkdown = paths.some(
    (path) => path === `${wrapper}/${SKILL_PACKAGE_MANIFEST_PATH}`,
  );

  return hasNestedSkillMarkdown ? wrapper : null;
}

function stripWrapper(path: string, wrapper: string): string {
  if (path === wrapper) {
    return "";
  }

  const prefix = `${wrapper}/`;

  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
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

export function normalizeSkillPackagePath(path: string): string {
  return admitSkillPackagePath(path);
}

export function admitSkillPackagePath(path: string): string {
  return admitSkillPackageArchivePathValue(path).path;
}

export function admitSkillPackageArchivePath(path: string): string {
  return admitSkillPackageArchivePathValue(path).path;
}

export { SKILL_PACKAGE_ALLOWED_ROOTS, SKILL_PACKAGE_MANIFEST_PATH } from "./path-admission";
