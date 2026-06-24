import type { JsonObject, JsonValue } from "@mosoo/contracts";
import type { AgentConfigChangeSnapshot } from "@mosoo/contracts/agent-config-change-plan";
import { parseDocument, stringify } from "yaml";

import { toEnvironmentId, toMcpServerId, toSkillId } from "@/routes/typed-id";

import type { Agent, AgentKind, McpServer, RuntimeId, SkillInfo } from "../../agent.types";
import { getRuntimeInfo } from "../../runtime-catalog";

export interface AgentEditorDraft {
  description: string;
  environmentId: string | null;
  kind: AgentKind;
  mcpServers: McpServer[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  runtime: RuntimeId;
  skills: SkillInfo[];
}

export function createInitialDraft(agent: Agent): AgentEditorDraft {
  return {
    description: agent.description,
    environmentId: agent.config.environmentId,
    kind: agent.kind,
    mcpServers: [...agent.config.mcpServers],
    model: agent.config.model,
    name: agent.name,
    prompt: agent.config.prompt,
    provider: agent.provider || getRuntimeInfo(agent.runtime).provider,
    providerOptions: agent.config.providerOptions,
    runtime: agent.runtime,
    skills: [...agent.config.skills],
  };
}

export function createSnapshot(draft: AgentEditorDraft): string {
  return JSON.stringify(toAgentConfigChangeSnapshot(draft));
}

export function createEditorSaveSnapshot(draft: AgentEditorDraft): string {
  return createSnapshot(draft);
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
    providerOptions: draft.providerOptions,
    runtimeId: draft.runtime,
    skills: draft.skills.map((skill) => ({
      id: toSkillId(skill.id),
      state: skill.state ?? "active",
    })),
  };
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
    settings: JsonObject;
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
    },
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
      settings: draft.providerOptions,
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
  const identity = asRecord(root["identity"]);
  const runtime = asRecord(root["runtime"]);
  const environment = asRecord(root["environment"]);
  const assets = asRecord(root["assets"]);

  return {
    description: readString(identity["description"], fallback.description),
    environmentId: readNullableString(environment["environmentId"], fallback.environmentId),
    kind: readAgentKind(root["kind"], fallback.kind),
    mcpServers: readMcpServers(assets["mcpServers"], fallback.mcpServers),
    model: readString(runtime["model"], fallback.model),
    name: readString(identity["name"], fallback.name),
    prompt: readString(root["prompt"], fallback.prompt),
    provider: readString(runtime["provider"], fallback.provider),
    providerOptions: readJsonObject(
      runtime["settings"] ?? runtime["providerOptions"],
      fallback.providerOptions,
    ),
    runtime: readString(runtime["id"], fallback.runtime),
    skills: readSkills(assets["skills"], fallback.skills),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }

  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function readJsonObject(value: unknown, fallback: JsonObject): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    return fallback;
  }

  return cloneJsonValue(value) as JsonObject;
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

    return [
      {
        ...(credentialMode === "runtime_resolved" || credentialMode === "agent_bound"
          ? { credentialMode }
          : {}),
        enabled: typeof enabled === "boolean" ? enabled : true,
        id,
        name,
        source: "app",
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
