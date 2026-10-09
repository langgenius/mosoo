import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type {
  AgentManifestMcpServerBinding,
  AgentPackageResolutionState,
} from "@mosoo/contracts/agent-manifest";
import { parseJsonObject } from "@mosoo/contracts/validation";
import type { JsonObject } from "@mosoo/contracts/validation";
import type { SkillId, SkillSnapshotId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";

interface StoredAgentConfig {
  builtInTools: AgentBuiltInToolConfig[];
  packageMcpServers: AgentManifestMcpServerBinding[];
  packageSkills: AgentStoredPackageSkill[];
  packageResolution: AgentPackageResolutionState | null;
  providerOptions: JsonObject;
}

export interface AgentStoredPackageSkill {
  currentSnapshotId: SkillSnapshotId;
  ownerName: string | null;
  packagePath: string;
  skillId: SkillId;
  skillName: string;
  sortOrder: number;
}

function normalizePackageSkillPath(value: string): string {
  const trimmed = value.trim().replaceAll(/^\/+|\/+$/g, "");

  if (!isTruthy(trimmed)) {
    throw new Error("Agent stored config package skill path must not be empty.");
  }

  return `${trimmed}/`;
}

// config_json is written only by serializeAgentStoredConfig; legacy rows may omit keys.
export function parseAgentStoredConfig(configJson: string): StoredAgentConfig {
  const stored = JSON.parse(configJson) as Partial<StoredAgentConfig>;

  return {
    builtInTools: normalizeAgentBuiltInTools(stored.builtInTools ?? []),
    packageMcpServers: (stored.packageMcpServers ?? []).map((server) => ({
      authType: server.authType,
      credentialMode: "runtime_resolved",
      credentialScope: server.credentialScope,
      enabled: server.enabled,
      iconUrl: server.iconUrl,
      name: server.name,
      serverId: null,
      source: server.source,
      url: server.url,
    })),
    packageSkills: stored.packageSkills ?? [],
    packageResolution: stored.packageResolution ?? null,
    providerOptions: stored.providerOptions ?? {},
  };
}

// Always writes every key: rollback builds read config_json with a strict parser.
export function serializeAgentStoredConfig(input: StoredAgentConfig): string {
  return JSON.stringify({
    builtInTools: normalizeAgentBuiltInTools(input.builtInTools).map((tool) => ({
      enabled: tool.enabled,
      name: tool.name,
    })),
    packageMcpServers: input.packageMcpServers.map((server) => ({
      authType: server.authType,
      credentialScope: server.credentialScope,
      enabled: server.enabled,
      iconUrl: server.iconUrl,
      name: server.name,
      source: server.source,
      url: server.url,
    })),
    packageSkills: input.packageSkills.map((skill) => ({
      currentSnapshotId: skill.currentSnapshotId,
      ownerName: skill.ownerName,
      packagePath: normalizePackageSkillPath(skill.packagePath),
      skillId: skill.skillId,
      skillName: skill.skillName,
      sortOrder: skill.sortOrder,
    })),
    packageResolution: input.packageResolution,
    providerOptions: parseJsonObject(input.providerOptions, "Agent stored config providerOptions"),
  });
}
