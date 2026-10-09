import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { AgentConfigChangeSnapshot } from "@mosoo/contracts/agent-config-change-plan";

import { toEnvironmentId, toMcpServerId, toSkillId } from "@/routes/typed-id";

import type { Agent, McpServer, RuntimeId, SkillInfo } from "../../agent.types";
import { getRuntimeInfo } from "../../runtime-catalog";

export interface AgentEditorDraft {
  builtInTools: AgentBuiltInToolConfig[];
  description: string;
  environmentId: string | null;
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
    builtInTools: normalizeAgentBuiltInTools(agent.config.builtInTools),
    description: agent.description,
    environmentId: agent.config.environmentId,
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

export function createEditorSaveSnapshot(draft: AgentEditorDraft): string {
  return JSON.stringify(toAgentConfigChangeSnapshot(draft));
}

export function toAgentConfigChangeSnapshot(draft: AgentEditorDraft): AgentConfigChangeSnapshot {
  return {
    builtInTools: normalizeAgentBuiltInTools(draft.builtInTools),
    description: draft.description,
    environmentId: draft.environmentId === null ? null : toEnvironmentId(draft.environmentId),
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
