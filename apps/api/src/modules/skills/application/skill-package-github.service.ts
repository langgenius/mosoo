import { ignorePromiseRejection } from "@mosoo/effects";
import { normalizeSkillEntries } from "@mosoo/skill-package";
import type { NormalizedSkillPackage } from "@mosoo/skill-package";

import { isTruthy } from "../../../shared/truthiness";
import {
  MAX_ENTRY_COUNT,
  MAX_SKILL_ENTRY_BYTES,
  MAX_SKILL_UNCOMPRESSED_BYTES,
  SkillRequestError,
} from "./skill-package.shared";
const GITHUB_API = "https://api.github.com";

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
    throw new SkillRequestError("GitHub API rate limited the request or requires authentication.");
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
    throw new SkillRequestError("GitHub API rate limited the request or requires authentication.");
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
    throw new SkillRequestError("GitHub API rate limited the request or requires authentication.");
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
    throw new SkillRequestError("GitHub API rate limited the request or requires authentication.");
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
    throw new SkillRequestError("GitHub API rate limited the request or requires authentication.");
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
