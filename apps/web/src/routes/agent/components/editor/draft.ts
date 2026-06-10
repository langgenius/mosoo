import type {
  AgentBuilderAgentTypeDecision,
  AgentBuilderComponentDecision,
  AgentBuilderComponentDecisions,
} from "@mosoo/contracts/agent-builder";
import type { AgentConfigChangeSnapshot } from "@mosoo/contracts/agent-config-change-plan";
import { parseDocument, stringify } from "yaml";

import { toEnvironmentId, toMcpServerId, toSkillId, toSpaceId } from "@/routes/typed-id";

import type {
  Agent,
  AgentKind,
  McpServer,
  RuntimeId,
  SkillInfo,
  SpaceBinding,
} from "../../agent.types";
import { getRuntimeInfo } from "../../runtime-catalog";

export interface AgentEditorDraft {
  componentDecisions: AgentBuilderComponentDecisions;
  description: string;
  environmentId: string | null;
  kind: AgentKind;
  mcpServers: McpServer[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtime: RuntimeId;
  skills: SkillInfo[];
  spaces: SpaceBinding[];
}

export function createInitialDraft(agent: Agent): AgentEditorDraft {
  return {
    componentDecisions: agent.config.builder.componentDecisions,
    description: agent.description,
    environmentId: agent.config.environmentId,
    kind: agent.kind,
    mcpServers: [...agent.config.mcpServers],
    model: agent.config.model,
    name: agent.name,
    prompt: agent.config.prompt,
    provider: agent.provider || getRuntimeInfo(agent.runtime).provider,
    runtime: agent.runtime,
    skills: [...agent.config.skills],
    spaces: [...agent.config.spaces],
  };
}

export function createSnapshot(draft: AgentEditorDraft): string {
  return JSON.stringify(toAgentConfigChangeSnapshot(draft));
}

export function createEditorSaveSnapshot(draft: AgentEditorDraft): string {
  return JSON.stringify({
    builder: {
      componentDecisions: draft.componentDecisions,
    },
    runtime: toAgentConfigChangeSnapshot(draft),
  });
}

export function createSnapshotHash(draft: AgentEditorDraft): string {
  return hashText(createSnapshot(draft));
}

export function toAgentConfigChangeSnapshot(draft: AgentEditorDraft): AgentConfigChangeSnapshot {
  return {
    description: draft.description,
    environmentId: draft.environmentId === null ? null : toEnvironmentId(draft.environmentId),
    kind: draft.kind,
    mcpServerIds: draft.mcpServers.map((server) => toMcpServerId(server.id)),
    model: draft.model,
    name: draft.name,
    prompt: draft.prompt,
    provider: draft.provider,
    runtimeId: draft.runtime,
    skills: draft.skills.map((skill) => ({
      id: toSkillId(skill.id),
      state: skill.state ?? "active",
    })),
    spaceIds: draft.spaces.map((space) => toSpaceId(space.id)),
  };
}

export function normalizeSpaces(spaces: SpaceBinding[]): SpaceBinding[] {
  const uniqueSpaces = new Map<string, SpaceBinding>();

  for (const space of spaces) {
    uniqueSpaces.set(space.id, space);
  }

  return [...uniqueSpaces.values()];
}

export function normalizeMcpServers(servers: McpServer[]): McpServer[] {
  const uniqueServers = new Map<string, McpServer>();

  for (const server of servers) {
    uniqueServers.set(server.id, server);
  }

  return [...uniqueServers.values()];
}

interface AgentDraftYamlShape {
  assets: {
    skills: {
      filename: string;
      id: string;
      name: string;
      state: "active" | "tombstone";
    }[];
    mcpServers: {
      credentialMode?: McpServer["credentialMode"];
      enabled: boolean;
      id: string;
      name: string;
      source?: McpServer["source"];
      url: string;
    }[];
    spaces: {
      id: string;
      name: string;
    }[];
  };
  builder?: {
    componentDecisions: AgentBuilderComponentDecisions;
  };
  environment: {
    environmentId: string | null;
  };
  identity: {
    description: string;
    name: string;
  };
  kind: AgentKind;
  prompt: string;
  runtime: {
    id: RuntimeId;
    model: string;
    provider: string;
  };
  version: 1;
}

function toDraftYamlShape(draft: AgentEditorDraft): AgentDraftYamlShape {
  return {
    assets: {
      skills: draft.skills.map((skill) => ({
        filename: skill.filename,
        id: skill.id,
        name: skill.name,
        state: skill.state ?? "active",
      })),
      mcpServers: normalizeMcpServers(draft.mcpServers).map(toDraftYamlMcpServer),
      spaces: normalizeSpaces(draft.spaces).map((space) => ({
        id: space.id,
        name: space.name,
      })),
    },
    ...(hasComponentDecisions(draft.componentDecisions)
      ? { builder: { componentDecisions: draft.componentDecisions } }
      : {}),
    environment: {
      environmentId: draft.environmentId,
    },
    identity: {
      description: draft.description,
      name: draft.name,
    },
    kind: draft.kind,
    prompt: draft.prompt,
    runtime: {
      id: draft.runtime,
      model: draft.model,
      provider: draft.provider,
    },
    version: 1,
  };
}

function toDraftYamlMcpServer(
  server: McpServer,
): AgentDraftYamlShape["assets"]["mcpServers"][number] {
  const yamlServer: AgentDraftYamlShape["assets"]["mcpServers"][number] = {
    enabled: server.enabled,
    id: server.id,
    name: server.name,
    url: server.url,
  };

  if (server.credentialMode !== undefined) {
    yamlServer.credentialMode = server.credentialMode;
  }

  if (server.source !== undefined) {
    yamlServer.source = server.source;
  }

  return yamlServer;
}

export function createDraftYaml(draft: AgentEditorDraft): string {
  return stringify(toDraftYamlShape(draft), {
    collectionStyle: "block",
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
}

export function createDraftYamlHash(draft: AgentEditorDraft): string {
  return hashText(createDraftYaml(draft));
}

export function parseDraftYaml(yaml: string, fallback: AgentEditorDraft): AgentEditorDraft {
  const parsed = parseDocument(yaml).toJSON();
  const root = asRecord(parsed);
  const builder = asRecord(root["builder"]);
  const identity = asRecord(root["identity"]);
  const runtime = asRecord(root["runtime"]);
  const environment = asRecord(root["environment"]);
  const assets = asRecord(root["assets"]);

  return {
    componentDecisions: readComponentDecisions(builder["componentDecisions"]),
    description: readString(identity["description"], fallback.description),
    environmentId: readNullableString(environment["environmentId"], fallback.environmentId),
    kind: readAgentKind(root["kind"], fallback.kind),
    mcpServers: readMcpServers(assets["mcpServers"], fallback.mcpServers),
    model: readString(runtime["model"], fallback.model),
    name: readString(identity["name"], fallback.name),
    prompt: readString(root["prompt"], fallback.prompt),
    provider: readString(runtime["provider"], fallback.provider),
    runtime: readString(runtime["id"], fallback.runtime),
    skills: readSkills(assets["skills"], fallback.skills),
    spaces: readSpaces(assets["spaces"], fallback.spaces),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : fallback;
}

function readAgentKind(value: unknown, fallback: AgentKind): AgentKind {
  return value === "pet" || value === "cattle" ? value : fallback;
}

function readComponentDecision(value: unknown): AgentBuilderComponentDecision | null {
  return value === "bound" || value === "created" || value === "skipped" ? value : null;
}

function readAgentTypeDecision(value: unknown): AgentBuilderAgentTypeDecision | null {
  return value === "decided" || value === "skipped" ? value : null;
}

function hasComponentDecisions(decisions: AgentBuilderComponentDecisions): boolean {
  return decisions.agentType !== undefined || decisions.environment !== undefined;
}

function readComponentDecisions(value: unknown): AgentBuilderComponentDecisions {
  const decisions = asRecord(value);
  const agentType = readAgentTypeDecision(decisions["agentType"]);
  const environment = readComponentDecision(decisions["environment"]);

  return {
    ...(agentType === null ? {} : { agentType }),
    ...(environment === null ? {} : { environment }),
  };
}

function readSkills(value: unknown, fallback: SkillInfo[]): SkillInfo[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.flatMap((entry) => {
    const skill = asRecord(entry);
    const id = skill["id"];
    const name = skill["name"];
    const filename = skill["filename"];

    if (typeof id !== "string" || typeof name !== "string" || typeof filename !== "string") {
      return [];
    }

    const state = skill["state"];
    return [
      {
        filename,
        id,
        name,
        ...(state === "tombstone" ? { state } : {}),
      },
    ];
  });
}

function readSpaces(value: unknown, fallback: SpaceBinding[]): SpaceBinding[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.flatMap((entry) => {
    const space = asRecord(entry);
    const id = space["id"];
    const name = space["name"];

    return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
  });
}

function readMcpServers(value: unknown, fallback: McpServer[]): McpServer[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.flatMap((entry) => {
    const server = asRecord(entry);
    const id = server["id"];
    const name = server["name"];
    const url = server["url"];

    if (typeof id !== "string" || typeof name !== "string" || typeof url !== "string") {
      return [];
    }

    const credentialMode = server["credentialMode"];
    const enabled = server["enabled"];
    const source = server["source"];

    return [
      {
        ...(credentialMode === "runtime_resolved" || credentialMode === "agent_bound"
          ? { credentialMode }
          : {}),
        enabled: typeof enabled === "boolean" ? enabled : true,
        id,
        name,
        ...(source === "personal" || source === "organization_shared" ? { source } : {}),
        type: "web" as const,
        url,
      },
    ];
  });
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
