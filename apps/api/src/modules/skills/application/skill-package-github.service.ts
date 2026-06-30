import { ignorePromiseRejection } from "@mosoo/effects";
import { normalizeSkillEntries } from "@mosoo/skill-package";
import type { NormalizedSkillPackage } from "@mosoo/skill-package";
import { unzipSync } from "fflate";

import { isTruthy } from "../../../shared/truthiness";
import {
  MAX_ENTRY_COUNT,
  MAX_SKILL_ENTRY_BYTES,
  MAX_SKILL_UNCOMPRESSED_BYTES,
  SkillRequestError,
} from "./skill-package.shared";
const GITHUB_API = "https://api.github.com";
const GITHUB_CODELOAD = "https://codeload.github.com";
const GITHUB_API_RATE_LIMIT_MESSAGE =
  "GitHub API rate limited the request or requires authentication.";

interface GithubSkillTarget {
  kind: "blob" | "repository" | "tree";
  owner: string;
  path: string;
  ref: string;
  relativePath: string;
  repo: string;
}

interface GithubContentEntry {
  download_url: string | null;
  path: string;
  type: "dir" | "file" | "submodule" | "symlink";
}

interface GithubDirectoryWalkState {
  totalBytes: number;
}

interface GithubArchiveTarget extends GithubSkillTarget {
  archiveRef: string;
}

interface GithubArchiveFileEntry {
  body: Uint8Array;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGithubContentEntry(value: unknown): value is GithubContentEntry {
  if (!isRecord(value)) {
    return false;
  }

  const { download_url: downloadUrl, path, type } = value;

  return (
    (downloadUrl === null || typeof downloadUrl === "string") &&
    typeof path === "string" &&
    (type === "dir" || type === "file" || type === "submodule" || type === "symlink")
  );
}

function readGithubContentEntryPath(value: unknown, fallbackPath: string): string {
  if (isRecord(value) && typeof value["path"] === "string" && value["path"].length > 0) {
    return value["path"];
  }

  return fallbackPath || "/";
}

function parseGithubContentEntries(value: unknown, path: string): GithubContentEntry[] {
  const entries = Array.isArray(value) ? value : [value];

  return entries.map((entry) => {
    if (!isGithubContentEntry(entry)) {
      throw new SkillRequestError(
        `GitHub content entry is invalid: ${readGithubContentEntryPath(entry, path)}`,
      );
    }

    return entry;
  });
}

export async function loadSkillPackageFromGithub(
  githubUrl: string,
  skillName?: string,
): Promise<NormalizedSkillPackage> {
  if (isTruthy(skillName)) {
    try {
      return await loadSkillPackageFromGithubArchive(githubUrl, skillName);
    } catch (error) {
      if (!isArchivePathMiss(error)) {
        throw error;
      }
    }
  }

  try {
    return await loadSkillPackageFromGithubApi(githubUrl, skillName);
  } catch (error) {
    if (isGithubApiRateLimitError(error)) {
      return loadSkillPackageFromGithubArchive(githubUrl, skillName);
    }

    throw error;
  }
}

async function loadSkillPackageFromGithubApi(
  githubUrl: string,
  skillName?: string,
): Promise<NormalizedSkillPackage> {
  const target = await resolveGithubSkillTarget(githubUrl, skillName);

  if (target.kind === "blob") {
    const body = await downloadGithubFile(target.owner, target.repo, target.ref, target.path);

    return normalizeSkillEntries({
      [target.relativePath]: {
        body,
        entryKind: "file",
      },
    });
  }

  const files = new Map<string, Uint8Array>();
  await walkGithubContents(files, target.owner, target.repo, target.ref, target.path, target.path, {
    totalBytes: 0,
  });

  if (files.size === 0) {
    throw new SkillRequestError("The directory is empty or could not be read.");
  }

  return normalizeSkillEntries(
    Object.fromEntries(
      [...files.entries()].map(([path, body]) => [
        path,
        {
          body,
          entryKind: "file" as const,
        },
      ]),
    ),
  );
}

async function loadSkillPackageFromGithubArchive(
  githubUrl: string,
  skillName?: string,
): Promise<NormalizedSkillPackage> {
  const targets = resolveGithubArchiveTargets(githubUrl);
  let lastError: SkillRequestError | null = null;

  for (const target of targets) {
    const response = await fetch(
      `${GITHUB_CODELOAD}/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zip/${encodeGithubPath(target.archiveRef)}`,
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
    const entries = stripSingleArchiveWrapper(readGithubArchiveFileEntries(archiveBytes));
    const selected = selectGithubArchiveEntries(entries, target, skillName);

    if (selected === null) {
      lastError = isTruthy(skillName)
        ? new SkillRequestError(
            `Skill "${skillName}" was not found in ${target.owner}/${target.repo}.`,
          )
        : new SkillRequestError(`GitHub path not found: ${target.path || "/"}`);
      continue;
    }

    assertGithubArchiveSelectionWithinLimits(selected);

    return normalizeSkillEntries(
      Object.fromEntries(
        selected.map((entry) => [
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
        archiveRef: "HEAD",
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
    archiveRef: ref,
    kind: mode,
    owner,
    path,
    ref,
    relativePath: mode === "blob" ? (path.split("/").filter(Boolean).at(-1) ?? "SKILL.md") : "",
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

function readGithubArchiveFileEntries(bytes: Uint8Array): GithubArchiveFileEntry[] {
  let files: Record<string, Uint8Array>;

  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new SkillRequestError(
      error instanceof Error ? error.message : "GitHub archive decompression failed.",
    );
  }

  return Object.entries(files).flatMap(([rawPath, body]): GithubArchiveFileEntry[] => {
    const path = rawPath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");

    if (!path || rawPath.endsWith("/")) {
      return [];
    }

    return [{ body, path }];
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

function assertGithubArchiveSelectionWithinLimits(entries: GithubArchiveFileEntry[]): void {
  if (entries.length > MAX_ENTRY_COUNT) {
    throw new SkillRequestError(
      `GitHub directory entry count exceeds the limit (${MAX_ENTRY_COUNT}).`,
    );
  }

  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.body.byteLength > MAX_SKILL_ENTRY_BYTES) {
      throw new SkillRequestError(
        `GitHub file exceeds the limit (${Math.floor(MAX_SKILL_ENTRY_BYTES / 1024 / 1024)} MB): ${entry.path}`,
      );
    }

    totalBytes += entry.body.byteLength;

    if (totalBytes > MAX_SKILL_UNCOMPRESSED_BYTES) {
      throw new SkillRequestError(
        `Total GitHub import size exceeds the limit (${Math.floor(MAX_SKILL_UNCOMPRESSED_BYTES / 1024 / 1024)} MB).`,
      );
    }
  }
}

function isGithubApiRateLimitError(error: unknown): boolean {
  return error instanceof SkillRequestError && error.message === GITHUB_API_RATE_LIMIT_MESSAGE;
}

function isArchivePathMiss(error: unknown): boolean {
  return (
    error instanceof SkillRequestError &&
    (error.message.startsWith("Skill ") ||
      error.message.startsWith("GitHub archive not found") ||
      error.message.startsWith("GitHub path not found"))
  );
}

function encodeGithubPath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function walkGithubContents(
  output: Map<string, Uint8Array>,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  rootPath: string,
  state: GithubDirectoryWalkState,
): Promise<void> {
  const normalizedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (response.status === 404) {
    throw new SkillRequestError(`GitHub path not found: ${path || "/"}`);
  }

  if (response.status === 403) {
    throw new SkillRequestError(GITHUB_API_RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new SkillRequestError(`GitHub API returned ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const entries = parseGithubContentEntries(payload, path);

  for (const entry of entries) {
    if (output.size >= MAX_ENTRY_COUNT) {
      throw new SkillRequestError(
        `GitHub directory entry count exceeds the limit (${MAX_ENTRY_COUNT}).`,
      );
    }

    if (entry.type === "dir") {
      await walkGithubContents(output, owner, repo, ref, entry.path, rootPath, state);
      continue;
    }

    if (entry.type !== "file" || !isTruthy(entry.download_url)) {
      continue;
    }

    const relativePath = rootPath
      ? entry.path.startsWith(`${rootPath}/`)
        ? entry.path.slice(rootPath.length + 1)
        : entry.path
      : entry.path;
    const body = await downloadGithubFileFromUrl(entry.download_url, entry.path);

    if (body.byteLength > MAX_SKILL_ENTRY_BYTES) {
      throw new SkillRequestError(
        `GitHub file exceeds the limit (${Math.floor(MAX_SKILL_ENTRY_BYTES / 1024 / 1024)} MB): ${entry.path}`,
      );
    }

    if (state.totalBytes + body.byteLength > MAX_SKILL_UNCOMPRESSED_BYTES) {
      throw new SkillRequestError(
        `Total GitHub import size exceeds the limit (${Math.floor(MAX_SKILL_UNCOMPRESSED_BYTES / 1024 / 1024)} MB).`,
      );
    }

    output.set(relativePath, body);
    state.totalBytes += body.byteLength;
  }
}

async function resolveGithubSkillTarget(
  url: string,
  skillName?: string,
): Promise<GithubSkillTarget> {
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
    const ref = await getDefaultBranch(owner, repo);

    if (isTruthy(skillName)) {
      return {
        kind: "tree",
        owner,
        path: await resolveSkillSubdirectory(owner, repo, ref, skillName, ""),
        ref,
        relativePath: "",
        repo,
      };
    }

    return {
      kind: "repository",
      owner,
      path: "",
      ref,
      relativePath: "",
      repo,
    };
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

  const branchNames = await listGithubBranches(owner, repo);
  const ref = longestMatchingRef(refAndPathSegments, branchNames) ?? refAndPathSegments[0]!;
  const refSegmentCount = ref.split("/").length;
  const rawPathSegments = refAndPathSegments.slice(refSegmentCount);
  const path = rawPathSegments.join("/");

  if (mode === "tree" && isTruthy(skillName)) {
    return {
      kind: "tree",
      owner,
      path: await resolveSkillSubdirectory(owner, repo, ref, skillName, path),
      ref,
      relativePath: "",
      repo,
    };
  }

  if (mode === "blob" && !path) {
    throw new SkillRequestError(
      mode === "blob"
        ? "GitHub file URL is missing a file path."
        : "GitHub tree URL is missing a directory path.",
    );
  }

  return {
    kind: mode,
    owner,
    path,
    ref,
    relativePath: mode === "blob" ? (rawPathSegments.at(-1) ?? "SKILL.md") : "",
    repo,
  };
}

/**
 * Resolves a `--skill <name>` selector (as used by skills.sh / `npx skills add`) to a concrete
 * directory inside the repository. Skills live under a `skills/` folder by convention
 * (e.g. vercel-labs/skills → skills/find-skills), but we also accept a top-level directory or a
 * `.claude/skills/<name>` layout so single-skill repos and Claude-style repos work too.
 */
async function resolveSkillSubdirectory(
  owner: string,
  repo: string,
  ref: string,
  skillName: string,
  basePath: string,
): Promise<string> {
  const base = basePath.replace(/^\/+|\/+$/g, "");
  const candidates = [
    joinGithubPath(base, "skills", skillName),
    joinGithubPath(base, skillName),
    joinGithubPath(base, ".claude", "skills", skillName),
  ];

  for (const candidate of candidates) {
    if (await githubPathIsDirectory(owner, repo, ref, candidate)) {
      return candidate;
    }
  }

  throw new SkillRequestError(
    `Skill "${skillName}" was not found in ${owner}/${repo}. Looked in: ${candidates.join(", ")}.`,
  );
}

function joinGithubPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("/");
}

async function githubPathIsDirectory(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<boolean> {
  const normalizedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (response.status === 404) {
    return false;
  }

  if (response.status === 403) {
    throw new SkillRequestError(GITHUB_API_RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new SkillRequestError(`GitHub API returned ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return Array.isArray(payload);
}

async function listGithubBranches(owner: string, repo: string): Promise<string[]> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (response.status === 403) {
    throw new SkillRequestError(GITHUB_API_RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new SkillRequestError(`GitHub branch lookup failed: ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((branch): string[] => {
    if (!isRecord(branch) || typeof branch["name"] !== "string") {
      return [];
    }

    return [branch["name"]];
  });
}

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (response.status === 403) {
    throw new SkillRequestError(GITHUB_API_RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new SkillRequestError(`Failed to read GitHub repository: ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!isRecord(payload) || typeof payload["default_branch"] !== "string") {
    throw new SkillRequestError("GitHub repository is missing default branch information.");
  }

  return payload["default_branch"];
}

function longestMatchingRef(segments: string[], candidates: string[]): string | null {
  let matched: string | null = null;

  for (let index = 1; index <= segments.length; index += 1) {
    const candidate = segments.slice(0, index).join("/");

    if (!candidates.includes(candidate)) {
      continue;
    }

    matched = candidate;
  }

  return matched;
}

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

async function downloadGithubFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<Uint8Array> {
  const normalizedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${normalizedPath}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (response.status === 404) {
    throw new SkillRequestError(`GitHub file not found: ${path}`);
  }

  if (response.status === 403) {
    throw new SkillRequestError(GITHUB_API_RATE_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new SkillRequestError(`GitHub API returned ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (
    !isGithubContentEntry(payload) ||
    payload.type !== "file" ||
    !isTruthy(payload.download_url)
  ) {
    throw new SkillRequestError(`GitHub path is not a file: ${path}`);
  }

  return downloadGithubFileFromUrl(payload.download_url, path);
}

async function downloadGithubFileFromUrl(url: string, path: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new SkillRequestError(`Failed to download GitHub file: ${path}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? "");

  if (!Number.isFinite(contentLength)) {
    throw new SkillRequestError(`GitHub file is missing a valid content-length header: ${path}`);
  }

  if (contentLength > MAX_SKILL_ENTRY_BYTES) {
    throw new SkillRequestError(
      `GitHub file exceeds the limit (${Math.floor(MAX_SKILL_ENTRY_BYTES / 1024 / 1024)} MB): ${path}`,
    );
  }

  return readResponseBytesWithLimit(response, MAX_SKILL_ENTRY_BYTES, path);
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
