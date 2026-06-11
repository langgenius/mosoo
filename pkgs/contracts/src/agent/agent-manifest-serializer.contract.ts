import type { JsonObject, JsonPrimitive, JsonValue } from "../validation/primitives.contract";
import type { AgentManifest, AgentPackage } from "./agent-manifest.contract";

function yamlString(value: string | null): string {
  if (value === null) {
    return "null";
  }

  return JSON.stringify(value);
}

function yamlJsonScalar(value: JsonPrimitive): string {
  if (typeof value === "string" || value === null) {
    return yamlString(value);
  }

  return String(value);
}

function yamlKey(value: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appendStringRecordYaml(lines: string[], record: Record<string, string>, indent: string) {
  const entries = Object.entries(record);

  if (entries.length === 0) {
    lines.push(`${indent}{}`);
    return;
  }

  for (const [key, value] of entries) {
    lines.push(`${indent}${key}: ${yamlString(value)}`);
  }
}

function appendJsonYaml(lines: string[], value: JsonValue, indent: string): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${indent}[]`);
      return;
    }

    for (const entry of value) {
      if (isJsonObject(entry) || Array.isArray(entry)) {
        lines.push(`${indent}-`);
        appendJsonYaml(lines, entry, `${indent}  `);
      } else {
        lines.push(`${indent}- ${yamlJsonScalar(entry)}`);
      }
    }
    return;
  }

  if (!isJsonObject(value)) {
    lines.push(`${indent}${yamlJsonScalar(value)}`);
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    lines.push(`${indent}{}`);
    return;
  }

  for (const [key, entry] of entries) {
    if (isJsonObject(entry) || Array.isArray(entry)) {
      lines.push(`${indent}${yamlKey(key)}:`);
      appendJsonYaml(lines, entry, `${indent}  `);
    } else {
      lines.push(`${indent}${yamlKey(key)}: ${yamlJsonScalar(entry)}`);
    }
  }
}

export function serializeAgentManifestToYaml(
  manifest: AgentManifest,
  sourceAgentId: string | null = null,
): string {
  const lines: string[] = [
    `manifestVersion: ${yamlString(manifest.manifestVersion)}`,
    ...(sourceAgentId === null ? [] : [`sourceAgentId: ${yamlString(sourceAgentId)}`]),
    `kind: ${yamlString(manifest.kind)}`,
    "metadata:",
    `  name: ${yamlString(manifest.metadata.name)}`,
    `  description: ${yamlString(manifest.metadata.description)}`,
    "runtime:",
    `  id: ${yamlString(manifest.runtime.id)}`,
    `  provider: ${yamlString(manifest.runtime.provider)}`,
    `  model: ${yamlString(manifest.runtime.model)}`,
    "  providerOptions:",
  ];

  appendJsonYaml(lines, manifest.runtime.providerOptions, "    ");

  lines.push("prompts:");
  lines.push("  system: |");

  const promptLines = manifest.prompts.system.split("\n");
  for (const promptLine of promptLines.length > 0 ? promptLines : [""]) {
    lines.push(`    ${promptLine}`);
  }

  lines.push("skills:");
  if (manifest.skills.length === 0) {
    lines.push("  []");
  } else {
    for (const skill of manifest.skills) {
      lines.push(`  - skillId: ${yamlString(skill.skillId)}`);
      lines.push(`    skillName: ${yamlString(skill.skillName)}`);
      lines.push(`    ownerName: ${yamlString(skill.ownerName)}`);
      lines.push(`    state: ${yamlString(skill.state)}`);
    }
  }

  lines.push("mcpServers:");
  if (manifest.mcpServers.length === 0) {
    lines.push("  []");
  } else {
    for (const server of manifest.mcpServers) {
      lines.push(`  - serverId: ${yamlString(server.serverId)}`);
      lines.push(`    name: ${yamlString(server.name)}`);
      lines.push(`    url: ${yamlString(server.url)}`);
      lines.push(`    source: ${yamlString(server.source)}`);
      lines.push(`    authType: ${yamlString(server.authType)}`);
      lines.push(`    credentialMode: ${yamlString(server.credentialMode)}`);
      lines.push(`    credentialScope: ${yamlString(server.credentialScope)}`);
      lines.push(`    enabled: ${server.enabled ? "true" : "false"}`);
    }
  }

  lines.push("environment:");
  lines.push(`  environmentId: ${yamlString(manifest.environment.environmentId)}`);
  lines.push(`  expectedName: ${yamlString(manifest.environment.expectedName)}`);
  lines.push(`  setupScript: ${yamlString(manifest.environment.setupScript)}`);
  lines.push("  envVars:");
  appendStringRecordYaml(lines, manifest.environment.envVars, "    ");

  lines.push("spaces:");
  if (manifest.spaces.length === 0) {
    lines.push("  []");
  } else {
    for (const space of manifest.spaces) {
      lines.push(`  - alias: ${yamlString(space.alias)}`);
      lines.push(`    mode: ${yamlString(space.mode)}`);
      lines.push(`    expectedName: ${yamlString(space.expectedName)}`);
      lines.push(`    required: ${space.required ? "true" : "false"}`);
      lines.push(`    spaceId: ${yamlString(space.spaceId)}`);
    }
  }

  if (manifest.advanced && Object.keys(manifest.advanced.unparsedFields).length > 0) {
    lines.push("advanced:");
    lines.push("  unparsedFields: {}");
  }

  return `${lines.join("\n")}\n`;
}

export function serializeAgentManifestToJson(
  manifest: AgentManifest,
  sourceAgentId: string | null = null,
): string {
  if (sourceAgentId === null) {
    return JSON.stringify(manifest, null, 2);
  }

  return JSON.stringify({ sourceAgentId, ...manifest }, null, 2);
}

export function serializeAgentPackageToJson(agentPackage: AgentPackage): string {
  return JSON.stringify(toAgentPackageManifestJson(agentPackage), null, 2);
}

export function createAgentPackageFileName(agentName: string): string {
  const normalized = agentName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return `${normalized || "agent"}.agent`;
}

export function createAgentPackageSkillPath(skillName: string): string {
  const normalized = skillName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return `skills/${normalized || "skill"}/`;
}

function toAgentPackageSkillPath(skill: AgentManifest["skills"][number]): string {
  if (skill.skillId.startsWith("skills/") && skill.skillId.endsWith("/")) {
    return skill.skillId;
  }

  return createAgentPackageSkillPath(skill.skillName);
}

export function toAgentPackageManifestJson(agentPackage: AgentPackage): Record<string, unknown> {
  const manifest = agentPackage.manifest;

  return {
    name: agentPackage.app.name,
    version: agentPackage.version,
    description: agentPackage.app.description,
    author: agentPackage.author,
    license: agentPackage.license,
    sourceAgentId: agentPackage.sourceAgentId,
    exportedAt: agentPackage.exportedAt,
    packageVersion: agentPackage.packageVersion,
    manifestVersion: manifest.manifestVersion,
    kind: manifest.kind,
    runtime: manifest.runtime.id,
    model: manifest.runtime.model,
    provider: manifest.runtime.provider,
    providerOptions: manifest.runtime.providerOptions,
    prompts: manifest.prompts,
    avatar: agentPackage.app.avatarAssetKey,
    skills: manifest.skills.map((skill) => ({
      name: skill.skillName,
      ownerName: skill.ownerName,
      path: toAgentPackageSkillPath(skill),
    })),
    mcpServers: manifest.mcpServers.map((server) => ({
      enabled: server.enabled,
      name: server.name,
      ref: `.mcp.json#${server.name}`,
    })),
    environment: {
      ref: "environment/definition.json",
    },
    spaceBindings: manifest.spaces.map((space) => ({
      alias: space.alias,
      expectedName: space.expectedName,
    })),
  };
}
