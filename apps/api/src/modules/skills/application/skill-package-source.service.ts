import type { SkillInspectResult, SkillSnapshotEntry } from "@mosoo/contracts/skill";
import {
  createMarkdownSkillPackage,
  extractZipArchive,
  looksLikeZipArchive,
  normalizeSkillEntries,
  SkillPackageError,
  toEntryRecord,
} from "@mosoo/skill-package";
import type { NormalizedSkillPackage, SkillPackageEntry } from "@mosoo/skill-package";

import { isTruthy } from "../../../shared/truthiness";
import { loadSkillPackageFromGithub } from "./skill-package-github.service";
import {
  inferMimeType,
  MAX_SKILL_UPLOAD_BYTES,
  SKILL_ARCHIVE_EXTRACT_OPTIONS,
  sha256Hex,
  SkillRequestError,
} from "./skill-package.shared";
import type { InspectSkillInput, UploadSkillFile } from "./skill-package.shared";
export async function inspectSkillInput(input: InspectSkillInput): Promise<SkillInspectResult> {
  const normalized = await loadNormalizedSkillPackage(input);

  return {
    entries: await Promise.all(normalized.entries.map(toSkillSnapshotEntry)),
    frontmatter: {
      ...(isTruthy(normalized.frontmatter.author) ? { author: normalized.frontmatter.author } : {}),
      description: normalized.frontmatter.description,
      name: normalized.frontmatter.name,
      ...(isTruthy(normalized.frontmatter.version)
        ? { version: normalized.frontmatter.version }
        : {}),
    },
    normalizedFileName: `${slugifyFileStem(normalized.frontmatter.name)}.skill`,
    skillMarkdownPath: normalized.skillMarkdownPath,
    warnings: [],
  };
}

export async function loadNormalizedSkillPackage(
  input: InspectSkillInput,
): Promise<NormalizedSkillPackage> {
  try {
    if (input.file) {
      if (input.file.bytes.byteLength > MAX_SKILL_UPLOAD_BYTES) {
        throw new SkillRequestError(
          `File exceeds the limit (${Math.floor(MAX_SKILL_UPLOAD_BYTES / 1024 / 1024)} MB).`,
        );
      }

      return loadSkillPackageFromFile(input.file);
    }

    if (isTruthy(input.githubUrl)) {
      return await loadSkillPackageFromGithub(input.githubUrl);
    }
  } catch (error) {
    if (error instanceof SkillRequestError) {
      throw error;
    }

    if (error instanceof SkillPackageError) {
      throw new SkillRequestError(error.message);
    }

    throw error;
  }

  throw new SkillRequestError("Either file or githubUrl must be provided.");
}

function loadSkillPackageFromFile(file: UploadSkillFile): NormalizedSkillPackage {
  const lowerName = file.name.toLowerCase();
  const zipLikeName = lowerName.endsWith(".zip") || lowerName.endsWith(".skill");

  if (lowerName.endsWith(".md")) {
    return createMarkdownSkillPackage(new TextDecoder().decode(file.bytes));
  }

  if (looksLikeZipArchive(file.bytes)) {
    return loadSkillPackageFromZip(file.bytes);
  }

  if (zipLikeName) {
    return loadSkillPackageFromZip(file.bytes);
  }

  if (looksLikeMarkdown(file.bytes)) {
    return createMarkdownSkillPackage(new TextDecoder().decode(file.bytes));
  }

  throw new SkillRequestError("Only .md, .zip, and .skill files are supported.");
}

function loadSkillPackageFromZip(bytes: Uint8Array): NormalizedSkillPackage {
  const entries = extractZipArchive(bytes, SKILL_ARCHIVE_EXTRACT_OPTIONS);

  return normalizeSkillEntries(toEntryRecord(entries));
}

async function toSkillSnapshotEntry(entry: SkillPackageEntry): Promise<SkillSnapshotEntry> {
  return {
    entryKind: entry.entryKind,
    isExecutable: entry.isExecutable,
    mimeType: inferMimeType(entry.path),
    path: entry.path,
    sha256: entry.entryKind === "file" ? await sha256Hex(entry.body) : null,
    size: entry.body.byteLength,
  };
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

function looksLikeMarkdown(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) {
    return false;
  }

  try {
    const prefix = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 256));
    return prefix.trimStart().startsWith("---");
  } catch {
    return false;
  }
}
