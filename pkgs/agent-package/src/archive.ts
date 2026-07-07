import type {
  AgentPackage,
  AgentResolutionIssue,
  AgentResolutionStatus,
} from "@mosoo/contracts/agent-manifest";
import {
  attachAgentPackageAssets,
  parseAgentPackageJson,
} from "@mosoo/contracts/agent-manifest-parser";
import { serializeAgentPackageToJson } from "@mosoo/contracts/agent-manifest-serializer";
import { createAdmittedZipArchive, extractZipArchive } from "@mosoo/skill-package";
import type { SkillPackageEntry } from "@mosoo/skill-package";

import { readPackageAssets } from "./archive-assets";
import { readArchiveText, textToArchiveBytes } from "./archive-bytes";
import {
  AGENT_PACKAGE_ARCHIVE_EXTRACT_OPTIONS,
  ENVIRONMENT_DEFINITION_PATH,
  MANIFEST_PATH,
  MCP_JSON_PATH,
} from "./archive-constants";
import {
  admitAgentPackageArchiveEntries,
  admitAgentPackageZipArchiveEntries,
} from "./archive-entry-admission";
import { createArchiveIssue } from "./archive-issue";
import {
  enforceExportArchiveEntryAllowed,
  enforceExportArchiveDeclarationsAllowed,
  collectArchiveAdmissionIssues,
  createAllowedArchivePaths,
  createExportArchiveCatalog,
  createExportSkillAssetRoots,
} from "./archive-path-policy";
import {
  attachEnvironmentDefinition,
  collectEnvironmentSidecarIssues,
  collectMcpSidecarIssues,
  mergeMcpSidecarJson,
} from "./archive-sidecars";

interface AgentPackageArchiveParseResult {
  issues: ReturnType<typeof parseAgentPackageJson>["issues"];
  manifest: ReturnType<typeof parseAgentPackageJson>["manifest"];
  package: AgentPackage | null;
}

function buildEnvironmentDefinition(agentPackage: AgentPackage): string {
  return JSON.stringify(
    {
      expectedName: agentPackage.manifest.environment.expectedName,
      secretNames: Object.keys(agentPackage.manifest.environment.envVars).toSorted(),
      setupScript: agentPackage.manifest.environment.setupScript,
    },
    null,
    2,
  );
}

function buildMcpJson(agentPackage: AgentPackage): string {
  const mcpServers = Object.fromEntries(
    agentPackage.manifest.mcpServers.map((server) => [
      server.name,
      {
        ...(server.iconUrl === null ? {} : { iconUrl: server.iconUrl }),
        type: server.url.endsWith("/sse") ? "sse" : "http",
        url: server.url,
      },
    ]),
  );

  return JSON.stringify({ mcpServers }, null, 2);
}

function createArchiveEntry(path: string, body: Uint8Array): SkillPackageEntry {
  return {
    body,
    entryKind: "file",
    isExecutable: false,
    path,
  };
}

function toArchiveEntryRecord(entries: SkillPackageEntry[]): Record<string, Uint8Array> {
  assertArchiveEntriesAdmitted(entries);

  const record: Record<string, Uint8Array> = {};

  for (const entry of entries) {
    if (entry.entryKind === "directory") {
      continue;
    }

    record[entry.path] = entry.body;
  }

  return record;
}

function assertArchiveEntriesAdmitted(entries: SkillPackageEntry[]): void {
  const admission = admitAgentPackageArchiveEntries(
    entries.map((entry) => ({
      entryKind: entry.entryKind,
      originalPath: entry.path,
    })),
  );

  if (!admission.ok) {
    throw new Error(admission.failure.message);
  }
}

export function createAgentPackageArchiveBytes(agentPackage: AgentPackage): Uint8Array {
  enforceExportArchiveDeclarationsAllowed(agentPackage);

  const allowedPaths = createAllowedArchivePaths(
    agentPackage,
    createExportArchiveCatalog(agentPackage),
  );
  const exportSkillAssetRoots = createExportSkillAssetRoots(agentPackage.assets);
  const entries: SkillPackageEntry[] = [
    createArchiveEntry(
      ENVIRONMENT_DEFINITION_PATH,
      textToArchiveBytes(buildEnvironmentDefinition(agentPackage)),
    ),
    createArchiveEntry(
      MANIFEST_PATH,
      textToArchiveBytes(serializeAgentPackageToJson(agentPackage)),
    ),
  ];

  if (agentPackage.manifest.mcpServers.length > 0) {
    entries.push(createArchiveEntry(MCP_JSON_PATH, textToArchiveBytes(buildMcpJson(agentPackage))));
  }

  for (const asset of agentPackage.assets) {
    enforceExportArchiveEntryAllowed(asset.key, allowedPaths, exportSkillAssetRoots, agentPackage);

    if (asset.contentBytes !== undefined) {
      entries.push(createArchiveEntry(asset.key, asset.contentBytes));
      continue;
    }

    if (asset.contentText === null) {
      continue;
    }
    entries.push(createArchiveEntry(asset.key, textToArchiveBytes(asset.contentText)));
  }

  assertArchiveEntriesAdmitted(entries);

  return createAdmittedZipArchive(entries);
}

export function parseAgentPackageArchiveBytes(
  archiveBytes: Uint8Array,
): AgentPackageArchiveParseResult {
  let entries: Record<string, Uint8Array>;

  const entryAdmission = admitAgentPackageZipArchiveEntries(archiveBytes);

  if (!entryAdmission.ok) {
    return invalidArchiveResult(
      entryAdmission.failure.code,
      entryAdmission.failure.message,
      "unsupported",
      entryAdmission.failure.path,
    );
  }

  try {
    entries = toArchiveEntryRecord(
      extractZipArchive(archiveBytes, AGENT_PACKAGE_ARCHIVE_EXTRACT_OPTIONS),
    );
  } catch {
    return invalidArchiveResult(
      "package.archive.invalid",
      "Agent package must be a valid .agent archive.",
      "unsupported",
      null,
    );
  }

  let manifestJson: string | null;

  try {
    manifestJson = readArchiveText(entries, MANIFEST_PATH);
  } catch {
    return invalidArchiveResult(
      "package.manifest.invalid",
      "Agent package manifest.json must be valid UTF-8 text under 2 MB.",
      "unsupported",
      MANIFEST_PATH,
    );
  }

  if (manifestJson === null) {
    return invalidArchiveResult(
      "package.manifest.missing",
      "Agent package archive must contain manifest.json.",
      "missing",
      MANIFEST_PATH,
    );
  }

  let mergedManifestJson: string;
  let environmentSidecarIssues: AgentResolutionIssue[];
  let mcpSidecarIssues: AgentResolutionIssue[];

  try {
    mergedManifestJson = mergeMcpSidecarJson(manifestJson, entries);
    environmentSidecarIssues = collectEnvironmentSidecarIssues(manifestJson, entries);
    mcpSidecarIssues = collectMcpSidecarIssues(manifestJson, entries);
  } catch {
    return invalidArchiveResult(
      "package.manifest.invalid",
      "Agent package manifest.json and sidecar JSON files must be valid JSON.",
      "unsupported",
      MANIFEST_PATH,
    );
  }

  if (
    environmentSidecarIssues.some((issue) => issue.status === "unsupported") ||
    mcpSidecarIssues.length > 0
  ) {
    return {
      issues: [...environmentSidecarIssues, ...mcpSidecarIssues],
      manifest: null,
      package: null,
    };
  }

  const parsed = parseAgentPackageJson(mergedManifestJson);

  if (!parsed.package) {
    return parsed;
  }

  const archiveAdmissionIssues = collectArchiveAdmissionIssues({
    agentPackage: parsed.package,
    entries,
    manifestJson,
  });

  if (archiveAdmissionIssues.some((issue) => issue.status === "unsupported")) {
    return {
      issues: [...parsed.issues, ...mcpSidecarIssues, ...archiveAdmissionIssues],
      manifest: null,
      package: null,
    };
  }

  const packageWithEnvironment = attachEnvironmentDefinition(parsed.package, manifestJson, entries);
  const assetResult = readPackageAssets(packageWithEnvironment, entries);
  const agentPackage = attachAgentPackageAssets(packageWithEnvironment, assetResult.assets);

  return {
    issues: [
      ...parsed.issues,
      ...environmentSidecarIssues,
      ...mcpSidecarIssues,
      ...assetResult.issues,
    ],
    manifest: agentPackage.manifest,
    package: agentPackage,
  };
}

function invalidArchiveResult(
  code: string,
  message: string,
  status: AgentResolutionStatus,
  targetLabel: string | null,
): AgentPackageArchiveParseResult {
  return {
    issues: [
      createArchiveIssue({
        code,
        message,
        status,
        targetLabel,
        targetType: "agent",
      }),
    ],
    manifest: null,
    package: null,
  };
}
