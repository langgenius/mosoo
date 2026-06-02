import type { AgentPackage, AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";

import { ENVIRONMENT_DEFINITION_PATH, MANIFEST_PATH, MCP_JSON_PATH } from "./archive-constants";
import {
  admitAgentPackageArchiveEntries,
  findReservedAgentPackageArchiveFilePath,
} from "./archive-entry-admission";
import { createArchiveIssue } from "./archive-issue";

interface ArchiveManifestCatalog {
  environmentDefinitionReferenced: boolean;
  mcpServerNames: Set<string>;
}

interface ArchivePathDeclaration {
  entryKind: "directory" | "file";
  path: string;
  targetLabel: string | null;
  targetType: AgentResolutionIssue["targetType"];
}

const SKILL_ALLOWED_ROOTS = ["assets/", "references/", "scripts/"] as const;
const ARCHIVE_PATH_FORBIDDEN_SEGMENTS = new Set([
  ".env",
  ".state",
  "audit",
  "channel",
  "channels",
  "cost",
  "credential",
  "credentials",
  "logs",
  "provenance",
  "runtime-state",
  "runtime_state",
  "secret",
  "secrets",
  "session",
  "sessions",
  "source-provenance",
  "source_provenance",
  "vault",
]);

export function createExportArchiveCatalog(agentPackage: AgentPackage): ArchiveManifestCatalog {
  return {
    environmentDefinitionReferenced: true,
    mcpServerNames: new Set(agentPackage.manifest.mcpServers.map((server) => server.name)),
  };
}

export function enforceExportArchiveEntryAllowed(
  path: string,
  allowedPaths: Set<string>,
  exportSkillAssetRoots: Set<string>,
  agentPackage: AgentPackage,
): void {
  const pathAdmission = admitAgentPackageArchiveEntries([
    { entryKind: "file", originalPath: path },
  ]);

  if (!pathAdmission.ok) {
    throw new Error(pathAdmission.failure.message);
  }

  const [admittedPath] = pathAdmission.entries;

  if (admittedPath === undefined) {
    throw new Error(`Package archive entry ${path} could not be admitted.`);
  }

  const reservedPath = findReservedAgentPackageArchiveFilePath(admittedPath.normalizedPath);

  if (reservedPath !== null) {
    throw new Error(
      `Package asset entry ${path} conflicts with reserved package file ${reservedPath}.`,
    );
  }

  const forbiddenSegment = findForbiddenArchivePathSegment(path);

  if (forbiddenSegment !== null) {
    throw new Error(
      `Package archive entry ${path} is not allowed because it contains private field ${forbiddenSegment}.`,
    );
  }

  if (!isAllowedArchivePath(path, allowedPaths, agentPackage, exportSkillAssetRoots)) {
    throw new Error(`Package archive entry ${path} is not declared by manifest.json.`);
  }
}

export function enforceExportArchiveDeclarationsAllowed(agentPackage: AgentPackage): void {
  const [issue] = collectArchiveDeclarationIssues(agentPackage);

  if (issue !== undefined) {
    throw new Error(issue.message);
  }
}

export function createExportSkillAssetRoots(assets: AgentPackage["assets"]): Set<string> {
  const roots = new Set<string>();

  for (const asset of assets) {
    if (asset.role !== "skill_file" || !asset.key.startsWith("skills/")) {
      continue;
    }

    const [, skillSlug] = asset.key.split("/");

    if (skillSlug) {
      roots.add(`skills/${skillSlug}/`);
    }
  }

  return roots;
}

export function collectArchiveAdmissionIssues(input: {
  agentPackage: AgentPackage;
  entries: Record<string, Uint8Array>;
  manifestJson: string;
}): AgentResolutionIssue[] {
  const catalog = readArchiveManifestCatalog(input.manifestJson);
  const allowedPaths = createAllowedArchivePaths(input.agentPackage, catalog);
  const issues: AgentResolutionIssue[] = collectArchiveDeclarationIssues(input.agentPackage);

  for (const path of Object.keys(input.entries)) {
    const forbiddenSegment = findForbiddenArchivePathSegment(path);

    if (forbiddenSegment !== null) {
      issues.push(
        createArchiveIssue({
          code: "package.archive.entry_forbidden",
          message: `Package archive entry ${path} is not allowed because it contains private field ${forbiddenSegment}.`,
          status: "unsupported",
          targetLabel: path,
          targetType: "agent",
        }),
      );
      continue;
    }

    if (isAllowedArchivePath(path, allowedPaths, input.agentPackage)) {
      continue;
    }

    issues.push(
      createArchiveIssue({
        code: "package.archive.entry_unsupported",
        message: `Package archive entry ${path} is not declared by manifest.json.`,
        status: "unsupported",
        targetLabel: path,
        targetType: "agent",
      }),
    );
  }

  return issues;
}

function collectArchiveDeclarationIssues(agentPackage: AgentPackage): AgentResolutionIssue[] {
  const issues: AgentResolutionIssue[] = [];

  for (const declaration of collectArchivePathDeclarations(agentPackage)) {
    const admission = admitAgentPackageArchiveEntries([
      { entryKind: declaration.entryKind, originalPath: declaration.path },
    ]);

    if (!admission.ok) {
      issues.push(
        createArchiveIssue({
          code: admission.failure.code,
          message: admission.failure.message,
          status: "unsupported",
          targetLabel: declaration.targetLabel,
          targetType: declaration.targetType,
        }),
      );
      continue;
    }

    const [entry] = admission.entries;

    if (entry === undefined) {
      issues.push(
        createArchiveIssue({
          code: "package.archive.entry_unsupported",
          message: `Package archive declaration ${declaration.path} could not be admitted.`,
          status: "unsupported",
          targetLabel: declaration.targetLabel,
          targetType: declaration.targetType,
        }),
      );
      continue;
    }

    const reservedPath = findReservedAgentPackageArchiveFilePath(entry.normalizedPath);

    if (reservedPath !== null) {
      issues.push(
        createArchiveIssue({
          code: "package.archive.entry_reserved",
          message: `Package archive declaration ${declaration.path} conflicts with reserved package file ${reservedPath}.`,
          status: "unsupported",
          targetLabel: declaration.targetLabel,
          targetType: declaration.targetType,
        }),
      );
    }
  }

  return issues;
}

function collectArchivePathDeclarations(agentPackage: AgentPackage): ArchivePathDeclaration[] {
  const declarations: ArchivePathDeclaration[] = [];
  const agentsMdPath = agentPackage.manifest.agentsMd?.assetKey ?? null;

  if (agentsMdPath !== null) {
    declarations.push({
      entryKind: "file",
      path: agentsMdPath,
      targetLabel: agentsMdPath,
      targetType: "agents_md",
    });
  }

  if (agentPackage.app.avatarAssetKey !== null) {
    declarations.push({
      entryKind: "file",
      path: agentPackage.app.avatarAssetKey,
      targetLabel: agentPackage.app.avatarAssetKey,
      targetType: "agent",
    });
  }

  for (const skill of agentPackage.manifest.skills) {
    const skillPath = skill.skillId.endsWith("/") ? skill.skillId : `${skill.skillId}/`;

    declarations.push({
      entryKind: "directory",
      path: skillPath,
      targetLabel: skill.skillName,
      targetType: "skill",
    });
  }

  return declarations;
}

export function createAllowedArchivePaths(
  agentPackage: AgentPackage,
  catalog: ArchiveManifestCatalog,
): Set<string> {
  const allowedPaths = new Set<string>([MANIFEST_PATH]);
  const agentsMdPath = agentPackage.manifest.agentsMd?.assetKey ?? null;

  if (catalog.environmentDefinitionReferenced) {
    allowedPaths.add(ENVIRONMENT_DEFINITION_PATH);
  }

  if (agentsMdPath !== null) {
    allowedPaths.add(agentsMdPath);
  }

  if (agentPackage.app.avatarAssetKey !== null) {
    allowedPaths.add(agentPackage.app.avatarAssetKey);
  }

  if (catalog.mcpServerNames.size > 0) {
    allowedPaths.add(MCP_JSON_PATH);
  }

  return allowedPaths;
}

function readArchiveManifestCatalog(manifestJson: string): ArchiveManifestCatalog {
  const parsedManifest: unknown = JSON.parse(manifestJson);
  const mcpServerNames = new Set<string>();
  let environmentDefinitionReferenced = false;

  if (!isRecord(parsedManifest)) {
    return { environmentDefinitionReferenced, mcpServerNames };
  }

  environmentDefinitionReferenced =
    readEnvironmentDefinitionRefFromManifest(parsedManifest) === ENVIRONMENT_DEFINITION_PATH;

  if (!Array.isArray(parsedManifest["mcpServers"])) {
    return { environmentDefinitionReferenced, mcpServerNames };
  }

  for (const server of parsedManifest["mcpServers"]) {
    if (!isRecord(server)) {
      continue;
    }

    const name = typeof server["name"] === "string" ? server["name"] : null;
    const ref = typeof server["ref"] === "string" ? server["ref"] : null;
    const mcpRefPrefix = `${MCP_JSON_PATH}#`;

    if (ref?.startsWith(mcpRefPrefix)) {
      mcpServerNames.add(name ?? ref.slice(mcpRefPrefix.length));
    }
  }

  return { environmentDefinitionReferenced, mcpServerNames };
}

function isAllowedArchivePath(
  path: string,
  allowedPaths: Set<string>,
  agentPackage: AgentPackage,
  exportSkillAssetRoots?: Set<string>,
): boolean {
  if (path.length === 0 || path.startsWith("/") || path.split("/").includes("..")) {
    return false;
  }

  if (allowedPaths.has(path)) {
    return true;
  }

  const skillRoots =
    exportSkillAssetRoots ??
    new Set(
      agentPackage.manifest.skills.map((skill) =>
        skill.skillId.endsWith("/") ? skill.skillId : `${skill.skillId}/`,
      ),
    );

  for (const skillPath of skillRoots) {
    if (!path.startsWith(skillPath)) {
      continue;
    }

    const relativePath = path.slice(skillPath.length);

    if (
      relativePath === "SKILL.md" ||
      SKILL_ALLOWED_ROOTS.some((allowedRoot) => relativePath.startsWith(allowedRoot))
    ) {
      return true;
    }
  }

  return false;
}

function findForbiddenArchivePathSegment(path: string): string | null {
  for (const segment of path.split("/")) {
    const normalized = segment.toLowerCase().replaceAll("_", "-");

    if (
      ARCHIVE_PATH_FORBIDDEN_SEGMENTS.has(normalized) ||
      (normalized.startsWith(".") && !(path === MCP_JSON_PATH && normalized === MCP_JSON_PATH)) ||
      normalized.startsWith(".env") ||
      normalized.startsWith(".state") ||
      normalized.includes("credential") ||
      normalized.includes("private") ||
      normalized.includes("provenance") ||
      normalized.includes("runtime-state") ||
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized === "key" ||
      normalized.endsWith(".key") ||
      normalized.endsWith(".pem") ||
      normalized.includes("vault")
    ) {
      return segment;
    }
  }

  return null;
}

function readEnvironmentDefinitionRefFromManifest(
  manifest: Record<string, unknown>,
): string | null {
  const environment = manifest["environment"];

  if (!isRecord(environment)) {
    return null;
  }

  const ref = environment["ref"];

  return typeof ref === "string" ? ref : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
