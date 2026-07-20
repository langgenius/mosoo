import type {
  InstallSkillsShSkillInput,
  SkillSummary,
  SkillsShCatalogResult,
  SkillsShCatalogSkill,
  SkillsShCatalogView,
  SkillsShSourceType,
} from "@mosoo/contracts/skill";
import type { AppId } from "@mosoo/id";
import { createZipArchive, normalizeSkillEntries, SkillPackageError } from "@mosoo/skill-package";
import type { NormalizedSkillPackage } from "@mosoo/skill-package";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { loadSkillPackageFromGithub } from "./skill-package-github.service";
import { createSkillFromUpload } from "./skill-package-write.service";
import {
  MAX_ENTRY_COUNT,
  MAX_SKILL_ENTRY_BYTES,
  MAX_SKILL_UNCOMPRESSED_BYTES,
  SkillRequestError,
} from "./skill-package.shared";

const SKILLS_SH_ORIGIN = "https://skills.sh";
const SKILLS_SH_PUBLIC_ORIGIN = "https://www.skills.sh";
const DEFAULT_CATALOG_PER_PAGE = 24;
const MAX_CATALOG_PER_PAGE = 60;
const MIN_SEARCH_LENGTH = 2;

interface ListSkillsShCatalogInput {
  page?: string;
  perPage?: string;
  query?: string;
  view?: string;
}

interface SkillsShApiSkill {
  id: string;
  installUrl: string | null;
  installs: number;
  isDuplicate: boolean;
  isOfficial: boolean;
  name: string;
  slug: string;
  source: string;
  sourceType: SkillsShSourceType;
  url: string;
}

interface PublicSkillsShSkill {
  installs: number;
  isOfficial: boolean;
  name: string;
  skillId: string;
  source: string;
}

interface ParsedPublicCatalog {
  skills: PublicSkillsShSkill[];
  total: number | null;
}

interface SkillsShDetailFile {
  contents: string;
  path: string;
}

interface SkillsShDetail {
  files: SkillsShDetailFile[] | null;
  id: string;
  slug: string;
  source: string;
}

interface SkillsShGitHubInstallTarget {
  githubUrl: string;
  skillName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

export async function listSkillsShCatalog(
  bindings: ApiBindings,
  input: ListSkillsShCatalogInput,
): Promise<SkillsShCatalogResult> {
  const view = parseCatalogView(input.view);
  const page = parseInteger(input.page, 0, 0, Number.MAX_SAFE_INTEGER);
  const perPage = parseInteger(input.perPage, DEFAULT_CATALOG_PER_PAGE, 1, MAX_CATALOG_PER_PAGE);
  const query = input.query?.trim() || null;
  const token = readSkillsShApiToken(bindings);

  if (token !== null) {
    return listSkillsShCatalogFromApi({ page, perPage, query, token, view });
  }

  return listSkillsShCatalogFromPublicPage({ page, perPage, query, view });
}

export async function createSkillFromSkillsSh(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  input: InstallSkillsShSkillInput,
): Promise<SkillSummary> {
  const normalized = await loadSkillPackageFromSkillsSh(bindings, input);
  const bytes = createZipArchive(normalized.entries);

  return createSkillFromUpload(bindings, viewer, appId, {
    file: {
      bytes,
      name: `${slugifyFileStem(normalized.frontmatter.name)}.skill`,
    },
  });
}

async function listSkillsShCatalogFromApi(input: {
  page: number;
  perPage: number;
  query: string | null;
  token: string;
  view: SkillsShCatalogView;
}): Promise<SkillsShCatalogResult> {
  const searchQuery =
    input.query !== null && input.query.length >= MIN_SEARCH_LENGTH ? input.query : null;
  const url =
    searchQuery === null
      ? new URL(`${SKILLS_SH_ORIGIN}/api/v1/skills`)
      : new URL(`${SKILLS_SH_ORIGIN}/api/v1/skills/search`);

  if (searchQuery === null) {
    url.searchParams.set("view", input.view);
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", String(input.perPage));
  } else {
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("limit", String(input.perPage));
  }

  const payload = await fetchSkillsShJson(url, input.token);
  const data = isRecord(payload) && Array.isArray(payload["data"]) ? payload["data"] : [];
  const skills = data.map(parseSkillsShApiSkill).filter(isNonNull);
  const pagination = isRecord(payload) ? payload["pagination"] : null;
  const total = readApiTotal(pagination, searchQuery === null ? null : payload);
  const hasMore =
    searchQuery === null && isRecord(pagination) && typeof pagination["hasMore"] === "boolean"
      ? pagination["hasMore"]
      : false;

  return {
    authConfigured: true,
    count: skills.length,
    hasMore,
    page: input.page,
    perPage: input.perPage,
    query: searchQuery,
    skills,
    source: "api",
    total,
    view: input.view,
  };
}

async function listSkillsShCatalogFromPublicPage(input: {
  page: number;
  perPage: number;
  query: string | null;
  view: SkillsShCatalogView;
}): Promise<SkillsShCatalogResult> {
  const url = publicCatalogUrl(input.view);
  const response = await fetch(url);

  if (!response.ok) {
    throw new SkillRequestError(`skills.sh directory returned ${response.status}.`, 502);
  }

  const catalog = parseSkillsShPublicCatalog(await response.text());
  const query =
    input.query !== null && input.query.length >= MIN_SEARCH_LENGTH ? input.query : null;
  const filtered =
    query === null ? catalog.skills : filterPublicCatalogSkills(catalog.skills, query);
  const start = input.page * input.perPage;
  const skills = filtered.slice(start, start + input.perPage).map(toCatalogSkillFromPublic);

  return {
    authConfigured: false,
    count: skills.length,
    hasMore: start + input.perPage < filtered.length,
    page: input.page,
    perPage: input.perPage,
    query,
    skills,
    source: "public-page",
    total: query === null ? catalog.total : filtered.length,
    view: input.view,
  };
}

async function loadSkillPackageFromSkillsSh(
  bindings: ApiBindings,
  input: InstallSkillsShSkillInput,
): Promise<NormalizedSkillPackage> {
  const token = readSkillsShApiToken(bindings);

  if (token !== null) {
    const fromDetail = await loadSkillPackageFromSkillsShDetail(input.id, token);

    if (fromDetail !== null) {
      return fromDetail;
    }
  }

  const target = resolveSkillsShGitHubInstallTarget(input);

  if (target !== null) {
    return loadSkillPackageFromGithub(target.githubUrl, target.skillName);
  }

  throw new SkillRequestError(
    "This skills.sh skill requires server-side skills.sh API access before Mosoo can install it.",
    400,
  );
}

async function loadSkillPackageFromSkillsShDetail(
  id: string,
  token: string,
): Promise<NormalizedSkillPackage | null> {
  const url = new URL(`${SKILLS_SH_ORIGIN}/api/v1/skills/${encodeSkillsShId(id)}`);
  const payload = await fetchSkillsShJson(url, token);
  const detail = parseSkillsShDetail(payload);

  if (detail.files === null) {
    return null;
  }

  return normalizeSkillsShDetailFiles(detail.files);
}

async function fetchSkillsShJson(url: URL, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    throw new SkillRequestError("skills.sh API token is missing, invalid, or expired.", 502);
  }

  if (response.status === 404) {
    throw new SkillRequestError("skills.sh skill was not found.", 404);
  }

  if (response.status === 429) {
    throw new SkillRequestError("skills.sh API rate limit exceeded.", 429);
  }

  if (!response.ok) {
    throw new SkillRequestError(`skills.sh API returned ${response.status}.`, 502);
  }

  return response.json();
}

export function parseSkillsShPublicCatalog(html: string): ParsedPublicCatalog {
  const marker = 'initialSkills\\":[';
  const start = html.indexOf(marker);

  if (start === -1) {
    throw new SkillRequestError("skills.sh directory payload was not found.", 502);
  }

  const arrayStart = start + 'initialSkills\\":'.length;
  const arrayEnd = html.indexOf('],\\"totalSkills\\":', arrayStart);

  if (arrayEnd === -1) {
    throw new SkillRequestError("skills.sh directory payload is incomplete.", 502);
  }

  const totalStart = arrayEnd + '],\\"totalSkills\\":'.length;
  const totalMatch = /^\d+/.exec(html.slice(totalStart));
  const skills = parsePublicSkillsArray(html.slice(arrayStart, arrayEnd + 1));
  const total = totalMatch ? Number(totalMatch[0]) : null;

  return {
    skills,
    total: Number.isSafeInteger(total) ? total : null,
  };
}

export function resolveSkillsShGitHubInstallTarget(
  input: Pick<InstallSkillsShSkillInput, "id" | "installUrl" | "slug">,
): SkillsShGitHubInstallTarget | null {
  const installUrl = input.installUrl?.trim();

  if (isTruthy(installUrl)) {
    const repositoryUrl = normalizeGithubRepositoryUrl(installUrl);

    if (repositoryUrl !== null) {
      return { githubUrl: repositoryUrl, skillName: input.slug };
    }
  }

  const source = sourceFromSkillsShId(input.id);

  if (source !== null && looksLikeGithubSource(source)) {
    return { githubUrl: `https://github.com/${source}`, skillName: input.slug };
  }

  return null;
}

function parsePublicSkillsArray(escapedArray: string): PublicSkillsShSkill[] {
  let decoded: string;

  try {
    decoded = JSON.parse(`"${escapedArray.replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`);
  } catch (error) {
    throw new SkillRequestError(
      error instanceof Error ? error.message : "skills.sh directory payload could not be decoded.",
      502,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(decoded);
  } catch (error) {
    throw new SkillRequestError(
      error instanceof Error ? error.message : "skills.sh directory payload is not valid JSON.",
      502,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new SkillRequestError("skills.sh directory payload is invalid.", 502);
  }

  return parsed.map(parsePublicSkillsShSkill).filter(isNonNull);
}

function parsePublicSkillsShSkill(value: unknown): PublicSkillsShSkill | null {
  if (!isRecord(value)) {
    return null;
  }

  const { installs, isOfficial, name, skillId, source } = value;

  if (
    typeof installs !== "number" ||
    typeof name !== "string" ||
    typeof skillId !== "string" ||
    typeof source !== "string"
  ) {
    return null;
  }

  return {
    installs,
    isOfficial: isOfficial === true,
    name,
    skillId,
    source,
  };
}

function parseSkillsShApiSkill(value: unknown): SkillsShCatalogSkill | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, installUrl, installs, isDuplicate, isOfficial, name, slug, source, sourceType, url } =
    value;

  if (
    typeof id !== "string" ||
    typeof installs !== "number" ||
    typeof name !== "string" ||
    typeof slug !== "string" ||
    typeof source !== "string"
  ) {
    return null;
  }

  const normalizedSourceType =
    sourceType === "github" || sourceType === "well-known"
      ? sourceType
      : inferSourceTypeFromSource(source);

  return {
    id,
    installUrl: typeof installUrl === "string" ? installUrl : defaultInstallUrl(source),
    installs,
    isDuplicate: isDuplicate === true,
    isOfficial: isOfficial === true,
    name,
    slug,
    source,
    sourceType: normalizedSourceType,
    url: typeof url === "string" ? url : skillsShSkillUrl(id),
  };
}

function parseSkillsShDetail(value: unknown): SkillsShDetail {
  if (!isRecord(value)) {
    throw new SkillRequestError("skills.sh skill detail payload is invalid.", 502);
  }

  const { files, id, slug, source } = value;

  if (typeof id !== "string" || typeof slug !== "string" || typeof source !== "string") {
    throw new SkillRequestError("skills.sh skill detail payload is missing required fields.", 502);
  }

  if (files === null) {
    return { files: null, id, slug, source };
  }

  if (!Array.isArray(files)) {
    throw new SkillRequestError("skills.sh skill detail files payload is invalid.", 502);
  }

  return {
    files: files.map(parseSkillsShDetailFile),
    id,
    slug,
    source,
  };
}

function parseSkillsShDetailFile(value: unknown): SkillsShDetailFile {
  if (!isRecord(value)) {
    throw new SkillRequestError("skills.sh skill file payload is invalid.", 502);
  }

  const { contents, path } = value;

  if (typeof contents !== "string" || typeof path !== "string") {
    throw new SkillRequestError("skills.sh skill file payload is missing required fields.", 502);
  }

  return { contents, path };
}

function normalizeSkillsShDetailFiles(files: SkillsShDetailFile[]): NormalizedSkillPackage {
  if (files.length > MAX_ENTRY_COUNT) {
    throw new SkillRequestError(
      `skills.sh skill entry count exceeds the limit (${MAX_ENTRY_COUNT}).`,
    );
  }

  const encoder = new TextEncoder();
  let totalBytes = 0;

  try {
    return normalizeSkillEntries(
      Object.fromEntries(
        files.map((file) => {
          const body = encoder.encode(file.contents);

          if (body.byteLength > MAX_SKILL_ENTRY_BYTES) {
            throw new SkillRequestError(
              `skills.sh skill file exceeds the limit (${Math.floor(MAX_SKILL_ENTRY_BYTES / 1024 / 1024)} MB): ${file.path}`,
            );
          }

          totalBytes += body.byteLength;

          if (totalBytes > MAX_SKILL_UNCOMPRESSED_BYTES) {
            throw new SkillRequestError(
              `Total skills.sh skill size exceeds the limit (${Math.floor(MAX_SKILL_UNCOMPRESSED_BYTES / 1024 / 1024)} MB).`,
            );
          }

          return [
            file.path,
            {
              body,
              entryKind: "file" as const,
              isExecutable: false,
            },
          ];
        }),
      ),
    );
  } catch (error) {
    if (error instanceof SkillRequestError) {
      throw error;
    }

    if (error instanceof SkillPackageError) {
      throw new SkillRequestError(error.message);
    }

    throw error;
  }
}

function filterPublicCatalogSkills(
  skills: PublicSkillsShSkill[],
  query: string,
): PublicSkillsShSkill[] {
  const needle = query.toLowerCase();

  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.skillId.toLowerCase().includes(needle) ||
      skill.source.toLowerCase().includes(needle),
  );
}

function toCatalogSkillFromPublic(skill: PublicSkillsShSkill): SkillsShApiSkill {
  const sourceType = inferSourceTypeFromSource(skill.source);
  const id = `${skill.source}/${skill.skillId}`;

  return {
    id,
    installUrl: defaultInstallUrl(skill.source),
    installs: skill.installs,
    isDuplicate: false,
    isOfficial: skill.isOfficial,
    name: skill.name,
    slug: skill.skillId,
    source: skill.source,
    sourceType,
    url: skillsShSkillUrl(id),
  };
}

function readApiTotal(pagination: unknown, payload: unknown): number | null {
  if (isRecord(pagination) && typeof pagination["total"] === "number") {
    return pagination["total"];
  }

  if (isRecord(payload) && typeof payload["count"] === "number") {
    return payload["count"];
  }

  return null;
}

function readSkillsShApiToken(bindings: ApiBindings): string | null {
  const token = bindings.SKILLS_SH_API_TOKEN?.trim() || bindings.VERCEL_OIDC_TOKEN?.trim() || "";

  return token.length > 0 ? token : null;
}

function parseCatalogView(value: string | undefined): SkillsShCatalogView {
  return value === "hot" || value === "trending" || value === "all-time" ? value : "all-time";
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function publicCatalogUrl(view: SkillsShCatalogView): string {
  if (view === "all-time") {
    return `${SKILLS_SH_PUBLIC_ORIGIN}/`;
  }

  return `${SKILLS_SH_PUBLIC_ORIGIN}/${view}`;
}

function inferSourceTypeFromSource(source: string): SkillsShSourceType {
  return looksLikeGithubSource(source) ? "github" : "well-known";
}

function defaultInstallUrl(source: string): string | null {
  return looksLikeGithubSource(source) ? `https://github.com/${source}` : `https://${source}`;
}

function sourceFromSkillsShId(id: string): string | null {
  const parts = id.split("/").filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return parts.slice(0, -1).join("/");
}

function looksLikeGithubSource(source: string): boolean {
  const parts = source.split("/");

  return parts.length === 2 && parts.every((part) => /^[a-z0-9_.-]+$/iu.test(part));
}

function normalizeGithubRepositoryUrl(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1];

  if (!isTruthy(owner) || !isTruthy(repo)) {
    return null;
  }

  return `https://github.com/${owner}/${repo.replace(/\.git$/iu, "")}`;
}

function skillsShSkillUrl(id: string): string {
  return `${SKILLS_SH_PUBLIC_ORIGIN}/${id.split("/").map(encodeURIComponent).join("/")}`;
}

function encodeSkillsShId(id: string): string {
  return id.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function slugifyFileStem(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 64) || "skill"
  );
}
