import { parseDocument } from "yaml";

import { SkillPackageError } from "./errors";
import { createSkillPackageArchivePathAdmission } from "./path-admission";
import type { SkillPackagePathKind } from "./path-admission";

export { SkillPackageError } from "./errors";

export interface SkillFrontmatter {
  author?: string;
  dependencies?: string[];
  description: string;
  name: string;
  userInvocable?: boolean;
  version?: string;
}

export interface ParsedSkillMarkdown {
  body: string;
  frontmatter: SkillFrontmatter;
}

const FRONTMATTER_DELIMITER = "---";

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const normalized = raw.replaceAll("\r\n", "\n");

  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new SkillPackageError("SKILL.md is missing frontmatter.");
  }

  const withoutOpener = normalized.slice(FRONTMATTER_DELIMITER.length + 1);
  const closerMatch = /\n---(?:\n|$)/u.exec(withoutOpener);

  if (closerMatch === null) {
    throw new SkillPackageError("SKILL.md frontmatter is not closed.");
  }

  const yaml = withoutOpener.slice(0, closerMatch.index).trim();
  const body = withoutOpener.slice(closerMatch.index + closerMatch[0].length);
  const rawFields = parseFrontmatterYaml(yaml);
  const name = requireStringField(rawFields, "name");
  const description = requireStringField(rawFields, "description");

  const frontmatter: SkillFrontmatter = {
    description,
    name,
  };
  const author = readOptionalStringField(rawFields, "author");
  const version = readOptionalStringField(rawFields, "version");
  const userInvocable = readOptionalBooleanField(rawFields, "user-invocable");
  const dependencies = readOptionalDependencyField(rawFields, "dependencies");

  if (author !== undefined && author.length > 0) {
    frontmatter.author = author;
  }

  if (version !== undefined && version.length > 0) {
    frontmatter.version = version;
  }

  if (userInvocable !== undefined) {
    frontmatter.userInvocable = userInvocable;
  }

  if (dependencies !== undefined && dependencies.length > 0) {
    frontmatter.dependencies = dependencies;
  }

  return {
    body,
    frontmatter,
  };
}

function parseFrontmatterYaml(rawYaml: string): Record<string, unknown> {
  try {
    const document = parseDocument(rawYaml, {
      prettyErrors: true,
      strict: true,
      uniqueKeys: true,
    });

    if (document.errors.length > 0) {
      throw new SkillPackageError(
        document.errors[0]?.message ?? "SKILL.md frontmatter could not be parsed.",
      );
    }

    const parsed: unknown = document.toJS();

    if (!isUnknownRecord(parsed)) {
      throw new SkillPackageError("SKILL.md frontmatter must be a YAML object.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SkillPackageError) {
      throw error;
    }

    throw new SkillPackageError(
      error instanceof Error ? error.message : "SKILL.md frontmatter could not be parsed.",
    );
  }
}

function requireStringField(fields: Record<string, unknown>, field: string): string {
  const value = fields[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new SkillPackageError(`SKILL.md frontmatter is missing required field \`${field}\`.`);
  }

  return value;
}

function readOptionalStringField(
  fields: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = fields[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new SkillPackageError(`SKILL.md frontmatter field \`${field}\` must be a string.`);
  }

  return value;
}

function readOptionalBooleanField(
  fields: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = fields[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new SkillPackageError(`SKILL.md frontmatter field \`${field}\` must be a boolean.`);
  }

  return value;
}

function readOptionalDependencyField(
  fields: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = fields[field];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new SkillPackageError(
      `SKILL.md frontmatter field \`${field}\` must be an array of strings.`,
    );
  }

  const result: string[] = [];
  const admission = createSkillPackageArchivePathAdmission();

  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new SkillPackageError(
        `SKILL.md frontmatter field \`${field}\` must be an array of strings.`,
      );
    }

    result.push(admission.admit(entry, inferFrontmatterDependencyKind(entry)).path);
  }

  return result;
}

function inferFrontmatterDependencyKind(path: string): SkillPackagePathKind {
  return path.endsWith("/") || path.endsWith("\\") ? "directory" : "file";
}
