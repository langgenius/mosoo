import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { SANDBOX_GLOBAL_SPACE_ROOT } from "@mosoo/driver-protocol";
import type { DriverExecutionSpec, DriverSkillCatalogEntry } from "@mosoo/driver-protocol";

import { isTruthy } from "../core/truthiness";
interface SkillCatalogManifestEntry {
  frontmatter: DriverSkillCatalogEntry["frontmatter"];
  mountPath: string;
  resolutionMode: DriverSkillCatalogEntry["resolutionMode"];
  skillId: string;
  skillMarkdownPath: string;
  skillName: string;
}

export interface SkillBootstrapArtifacts {
  manifestPath: string;
  readmePath: string;
}

function getSkillCatalogRoot(execution: DriverExecutionSpec): string {
  return join(execution.session.context.sessionOrganizationPath, ".mosoo", "skills");
}

function toRelativeOrganizationAlias(execution: DriverExecutionSpec, aliasPath: string): string {
  const relativePath = relative(execution.session.cwd, aliasPath);

  if (!relativePath || relativePath.startsWith("..")) {
    return aliasPath;
  }

  return relativePath;
}

function buildOrganizationBootstrapSection(execution: DriverExecutionSpec): string | null {
  const { context, cwd } = execution.session;
  const aliasEntries = context.spaceAliases.map((alias) => ({
    absoluteAliasPath: alias.aliasPath,
    aliasPath: toRelativeOrganizationAlias(execution, alias.aliasPath),
    label: `Space ${alias.spaceName}`,
    spaceName: alias.spaceName,
  }));
  const lines = [
    "Organization file layout:",
    `Current working directory: ${cwd}`,
    `Visible spaces are explicitly mounted under the session directory at \`${cwd}/space/<space-name>/\`.`,
    "Persistent user files are exposed through those session-local `space/<space-name>/...` mount points inside the working directory.",
    "Use those `space/*` directories for user-managed files. Files created elsewhere in the working directory are conversation-local scratch files and are not part of any Space.",
    `Prefer the relative \`space/*\` aliases instead of internal mount paths such as \`${SANDBOX_GLOBAL_SPACE_ROOT}/*\`.`,
  ];

  if (aliasEntries.length === 0) {
    lines.push("No visible Space aliases are mounted for this session.");
    return lines.join("\n");
  }

  lines.push(
    "Visible space aliases:",
    ...aliasEntries.map(
      (entry) => `- ${entry.aliasPath} -> ${entry.absoluteAliasPath}: ${entry.label}`,
    ),
  );

  return lines.join("\n");
}

function getSkillCatalogManifestEntries(
  execution: DriverExecutionSpec,
): SkillCatalogManifestEntry[] {
  return execution.skillCatalog.map((entry) => ({
    frontmatter: entry.frontmatter,
    mountPath: entry.mountPath,
    resolutionMode: entry.resolutionMode,
    skillId: entry.skillId,
    skillMarkdownPath: join(entry.mountPath, "SKILL.md"),
    skillName: entry.skillName,
  }));
}

function buildSkillCatalogReadme(execution: DriverExecutionSpec): string {
  const manifestEntries = getSkillCatalogManifestEntries(execution);
  const lines = [
    "# Skill Catalog",
    "",
    "The driver prepared the following skill packages for this session.",
    "Only open a skill's `SKILL.md` when the current task clearly matches that skill.",
    "Do not assume the full skill text has already been loaded.",
    "",
  ];

  if (manifestEntries.length === 0) {
    lines.push("No skills are available for this session.", "");
    return lines.join("\n");
  }

  lines.push("## Entries", "");

  for (const entry of manifestEntries) {
    const summary = entry.frontmatter.description?.trim() ?? "No summary provided.";
    lines.push(`- ${entry.skillName} (${entry.resolutionMode})`);
    lines.push(`  Summary: ${summary}`);
    lines.push(`  Path: ${entry.skillMarkdownPath}`);

    if (entry.resolutionMode === "tombstone") {
      lines.push("  Status: unavailable in this session; skip it.");
    }

    lines.push("");
  }

  return lines.join("\n");
}

export async function writeSkillBootstrapArtifacts(
  execution: DriverExecutionSpec,
): Promise<SkillBootstrapArtifacts | null> {
  if (execution.skillCatalog.length === 0) {
    return null;
  }

  const skillCatalogRoot = getSkillCatalogRoot(execution);
  const manifestPath = join(skillCatalogRoot, "manifest.json");
  const readmePath = join(skillCatalogRoot, "README.md");

  await mkdir(skillCatalogRoot, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(getSkillCatalogManifestEntries(execution), null, 2),
    "utf8",
  );
  await writeFile(readmePath, buildSkillCatalogReadme(execution), "utf8");

  return {
    manifestPath,
    readmePath,
  };
}

export function buildRuntimeBootstrapText(execution: DriverExecutionSpec): string {
  const profilePrompt = execution.profilePrompt.trim();
  const organizationBootstrap = buildOrganizationBootstrapSection(execution);
  const manifestPath = join(getSkillCatalogRoot(execution), "manifest.json");
  const readmePath = join(getSkillCatalogRoot(execution), "README.md");
  const availableSkills = execution.skillCatalog.filter(
    (entry) => entry.resolutionMode !== "tombstone",
  );
  const unavailableSkills = execution.skillCatalog.filter(
    (entry) => entry.resolutionMode === "tombstone",
  );

  if (!profilePrompt && execution.skillCatalog.length === 0 && !isTruthy(organizationBootstrap)) {
    return "";
  }

  const sections = [
    "Internal runtime bootstrap for this session.",
    "Record these instructions for future turns.",
    "Do not treat this as an end-user request.",
    "Do not ask follow-up questions, do not call tools, and do not modify files in response to this bootstrap message.",
  ];

  if (profilePrompt) {
    sections.push(`Agent profile prompt:\n${profilePrompt}`);
  }

  if (isTruthy(organizationBootstrap)) {
    sections.push(organizationBootstrap);
  }

  if (execution.skillCatalog.length > 0) {
    const skillLines = [
      `Skill catalog README: ${readmePath}`,
      `Skill catalog manifest: ${manifestPath}`,
      "When a task clearly matches one of the listed skills, open that skill's `SKILL.md` on demand before acting.",
    ];

    if (availableSkills.length > 0) {
      skillLines.push(
        "Available skills:",
        ...availableSkills.map((entry) => {
          const summary = entry.frontmatter.description?.trim() ?? "No summary provided.";
          return `- ${entry.skillName}: ${summary}. Skill file: ${join(entry.mountPath, "SKILL.md")}`;
        }),
      );
    }

    if (unavailableSkills.length > 0) {
      skillLines.push(
        "Unavailable skills to ignore for this session:",
        ...unavailableSkills.map((entry) => `- ${entry.skillName}`),
      );
    }

    sections.push(skillLines.join("\n"));
  }

  sections.push("Reply with exactly READY.");
  return sections.join("\n\n");
}

export function buildNativeRuntimeSystemPrompt(execution: DriverExecutionSpec): string | null {
  const bootstrap = buildRuntimeBootstrapText(execution)
    .replace("Internal runtime bootstrap for this session.", "Runtime context for this session.")
    .replace("Record these instructions for future turns.", "")
    .replace("Do not treat this as an end-user request.", "")
    .replace(
      "Do not ask follow-up questions, do not call tools, and do not modify files in response to this bootstrap message.",
      "",
    )
    .replace("Reply with exactly READY.", "")
    .trim();

  return bootstrap.length > 0 ? bootstrap : null;
}

export function computeRuntimeBootstrapDigest(execution: DriverExecutionSpec): string | null {
  const bootstrapText = buildRuntimeBootstrapText(execution);

  if (!bootstrapText) {
    return null;
  }

  return createHash("sha256").update("runtime-bootstrap-v1\n").update(bootstrapText).digest("hex");
}
