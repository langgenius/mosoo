import { ignorePromiseRejection } from "@mosoo/effects";
import { normalizeSkillEntries } from "@mosoo/skill-package";
import type { NormalizedSkillPackage } from "@mosoo/skill-package";
import { unzipSync } from "fflate";
import type { UnzipFileFilter, Unzipped } from "fflate";

import { isTruthy } from "../../../shared/truthiness";
import {
  MAX_ENTRY_COUNT,
  MAX_SKILL_ENTRY_BYTES,
  MAX_SKILL_UNCOMPRESSED_BYTES,
  SkillRequestError,
} from "./skill-package.shared";
const GITHUB_CODELOAD = "https://codeload.github.com";

interface GithubArchiveTarget {
  kind: "blob" | "repository" | "tree";
  owner: string;
  path: string;
  ref: string;
  relativePath: string;
  repo: string;
}

// Selection works on names only; `name` is the raw ZIP entry inflated later.
interface GithubArchiveFileEntry {
  name: string;
  path: string;
}

export async function loadSkillPackageFromGithub(
  githubUrl: string,
  skillName?: string,
): Promise<NormalizedSkillPackage> {
  const targets = resolveGithubArchiveTargets(githubUrl);
  let lastError: SkillRequestError | null = null;

  for (const target of targets) {
    const response = await fetch(
      `${GITHUB_CODELOAD}/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zip/${encodeGithubPath(target.ref)}`,
    );

    if (response.status === 404) {
      lastError = new SkillRequestError(`GitHub archive not found for ref: ${target.ref}`);
      continue;
    }

    if (!response.ok) {
      throw new SkillRequestError(`GitHub archive returned ${response.status}.`);
    }

    const archiveBytes = await readResponseBytesWithLimit(
      response,
      MAX_SKILL_UNCOMPRESSED_BYTES,
      `${target.owner}/${target.repo}@${target.ref}`,
    );
    const entries = stripSingleArchiveWrapper(listGithubArchiveFileEntries(archiveBytes));
    const selected = selectGithubArchiveEntries(entries, target, skillName);

    if (selected === null) {
      lastError = isTruthy(skillName)
        ? new SkillRequestError(
            `Skill "${skillName}" was not found in ${target.owner}/${target.repo}.`,
          )
        : new SkillRequestError(`GitHub path not found: ${target.path || "/"}`);
      continue;
    }

    return normalizeSkillEntries(
      Object.fromEntries(
        inflateGithubArchiveSelection(archiveBytes, selected).map((entry) => [
          entry.path,
          {
            body: entry.body,
            entryKind: "file" as const,
          },
        ]),
      ),
    );
  }

  throw (
    lastError ??
    new SkillRequestError(
      isTruthy(skillName)
        ? `Skill "${skillName}" was not found.`
        : "GitHub archive could not be read.",
    )
  );
}

function resolveGithubArchiveTargets(url: string): GithubArchiveTarget[] {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new SkillRequestError("Invalid GitHub URL format.");
  }

  if (parsed.hostname !== "github.com") {
    throw new SkillRequestError("Only github.com directory links are supported.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new SkillRequestError("GitHub URL is missing owner/repo.");
  }

  const owner = segments[0]!;
  const repo = stripDotGit(segments[1]!);

  if (segments.length === 2) {
    return [
      {
        kind: "repository",
        owner,
        path: "",
        ref: "HEAD",
        relativePath: "",
        repo,
      },
    ];
  }

  const mode = segments[2];

  if (mode !== "tree" && mode !== "blob") {
    throw new SkillRequestError(
      "GitHub URL must point to the repository root, a directory, or a SKILL.md file.",
    );
  }

  const refAndPathSegments = segments.slice(3);

  if (refAndPathSegments.length === 0) {
    throw new SkillRequestError("GitHub URL is missing a ref.");
  }

  return readGithubArchiveRefCandidates(refAndPathSegments).map(({ path, ref }) => ({
    kind: mode,
    owner,
    path,
    ref,
    relativePath:
      mode === "blob"
        ? (path.split("/").findLast((segment) => segment.length > 0) ?? "SKILL.md")
        : "",
    repo,
  }));
}

function readGithubArchiveRefCandidates(
  refAndPathSegments: string[],
): Array<{ path: string; ref: string }> {
  if (isLikelySingleSegmentRef(refAndPathSegments[0]!)) {
    return [
      {
        path: refAndPathSegments.slice(1).join("/"),
        ref: refAndPathSegments[0]!,
      },
    ];
  }

  return refAndPathSegments
    .map((_segment, index) => {
      const refSegmentCount = index + 1;
      return {
        path: refAndPathSegments.slice(refSegmentCount).join("/"),
        ref: refAndPathSegments.slice(0, refSegmentCount).join("/"),
      };
    })
    .toReversed();
}

function isLikelySingleSegmentRef(ref: string): boolean {
  return (
    ref === "HEAD" ||
    ref === "main" ||
    ref === "master" ||
    /^[0-9a-f]{7,40}$/iu.test(ref) ||
    /^v?\d+(?:\.\d+){1,3}(?:[-+][a-z0-9.-]+)?$/iu.test(ref)
  );
}

function unzipGithubArchive(bytes: Uint8Array, filter: UnzipFileFilter): Unzipped {
  try {
    return unzipSync(bytes, { filter });
  } catch (error) {
    throw new SkillRequestError(
      error instanceof Error ? error.message : "GitHub archive decompression failed.",
    );
  }
}

// Lists entry names without inflating anything: the archive is a whole
// repository, and only the selected skill may be decompressed.
function listGithubArchiveFileEntries(bytes: Uint8Array): GithubArchiveFileEntry[] {
  const entries: GithubArchiveFileEntry[] = [];

  unzipGithubArchive(bytes, ({ name }) => {
    const path = name.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");

    if (path && !name.endsWith("/")) {
      entries.push({ name, path });
    }

    return false;
  });

  return entries;
}

// The limits run in the filter, before fflate allocates: it sizes a deflated
// entry by its declared original size and copies a stored entry's data.
function inflateGithubArchiveSelection(
  bytes: Uint8Array,
  selected: GithubArchiveFileEntry[],
): Array<{ body: Uint8Array; path: string }> {
  const pathsByName = new Map(selected.map((entry) => [entry.name, entry.path]));
  let entryCount = 0;
  let totalBytes = 0;

  const files = unzipGithubArchive(bytes, (file) => {
    const path = pathsByName.get(file.name);

    if (path === undefined) {
      return false;
    }

    const entryBytes = Math.max(file.size, file.originalSize);
    entryCount += 1;
    totalBytes += entryBytes;

    if (entryCount > MAX_ENTRY_COUNT) {
      throw new SkillRequestError(
        `GitHub directory entry count exceeds the limit (${MAX_ENTRY_COUNT}).`,
      );
    }

    if (entryBytes > MAX_SKILL_ENTRY_BYTES) {
      throw new SkillRequestError(
        `GitHub file exceeds the limit (${Math.floor(MAX_SKILL_ENTRY_BYTES / 1024 / 1024)} MB): ${path}`,
      );
    }

    if (totalBytes > MAX_SKILL_UNCOMPRESSED_BYTES) {
      throw new SkillRequestError(
        `Total GitHub import size exceeds the limit (${Math.floor(MAX_SKILL_UNCOMPRESSED_BYTES / 1024 / 1024)} MB).`,
      );
    }

    return true;
  });

  return selected.map((entry) => {
    const body = files[entry.name];

    if (body === undefined) {
      throw new SkillRequestError(`GitHub archive entry could not be read: ${entry.path}`);
    }

    return { body, path: entry.path };
  });
}

function stripSingleArchiveWrapper(entries: GithubArchiveFileEntry[]): GithubArchiveFileEntry[] {
  const wrappers = new Set(entries.map((entry) => entry.path.split("/")[0]).filter(isTruthy));

  if (wrappers.size !== 1) {
    return entries;
  }

  const [wrapper] = wrappers;

  if (!wrapper) {
    return entries;
  }

  return entries.flatMap((entry): GithubArchiveFileEntry[] => {
    const strippedPath = entry.path.startsWith(`${wrapper}/`)
      ? entry.path.slice(wrapper.length + 1)
      : "";

    return strippedPath ? [{ ...entry, path: strippedPath }] : [];
  });
}

function selectGithubArchiveEntries(
  entries: GithubArchiveFileEntry[],
  target: GithubArchiveTarget,
  skillName?: string,
): GithubArchiveFileEntry[] | null {
  if (isTruthy(skillName)) {
    const skillDirectory = findGithubArchiveSkillDirectory(entries, target.path, skillName);

    return skillDirectory === null ? null : selectEntriesUnderPath(entries, skillDirectory);
  }

  if (target.kind === "blob") {
    const entry = entries.find((candidate) => candidate.path === target.path);

    return entry ? [{ ...entry, path: target.relativePath }] : null;
  }

  return selectEntriesUnderPath(entries, target.path);
}

function findGithubArchiveSkillDirectory(
  entries: GithubArchiveFileEntry[],
  basePath: string,
  skillName: string,
): string | null {
  const base = basePath.replace(/^\/+|\/+$/g, "");
  const preferredCandidates = [
    joinGithubPath(base, "skills", skillName),
    joinGithubPath(base, skillName),
    joinGithubPath(base, ".claude", "skills", skillName),
  ];
  const skillDirectories = entries
    .flatMap((entry): string[] => {
      if (!entry.path.endsWith("/SKILL.md") && entry.path !== "SKILL.md") {
        return [];
      }

      const directory = entry.path === "SKILL.md" ? "" : entry.path.slice(0, -"/SKILL.md".length);

      if (!pathIsAtOrUnderBase(directory, base)) {
        return [];
      }

      return directory.split("/").at(-1) === skillName ? [directory] : [];
    })
    .toSorted((left, right) => {
      const preferredDelta =
        readPreferredCandidateRank(left, preferredCandidates) -
        readPreferredCandidateRank(right, preferredCandidates);

      if (preferredDelta !== 0) {
        return preferredDelta;
      }

      const depthDelta = left.split("/").length - right.split("/").length;
      return depthDelta !== 0 ? depthDelta : left.localeCompare(right);
    });

  return skillDirectories[0] ?? null;
}

function readPreferredCandidateRank(candidate: string, preferredCandidates: string[]): number {
  const index = preferredCandidates.indexOf(candidate);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function pathIsAtOrUnderBase(path: string, base: string): boolean {
  return base.length === 0 || path === base || path.startsWith(`${base}/`);
}

function selectEntriesUnderPath(
  entries: GithubArchiveFileEntry[],
  rootPath: string,
): GithubArchiveFileEntry[] | null {
  const root = rootPath.replace(/^\/+|\/+$/g, "");
  const selected = entries.flatMap((entry): GithubArchiveFileEntry[] => {
    if (root.length === 0) {
      return [{ ...entry }];
    }

    if (entry.path === root) {
      return [{ ...entry, path: entry.path.split("/").at(-1) ?? "SKILL.md" }];
    }

    if (!entry.path.startsWith(`${root}/`)) {
      return [];
    }

    return [{ ...entry, path: entry.path.slice(root.length + 1) }];
  });

  return selected.length > 0 ? selected : null;
}

function encodeGithubPath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function joinGithubPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("/");
}

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  path: string,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new SkillRequestError(`GitHub file response body is empty: ${path}`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        throw new SkillRequestError(
          `GitHub file exceeds the limit (${Math.floor(maxBytes / 1024 / 1024)} MB): ${path}`,
        );
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(ignorePromiseRejection);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}
