import { isSupportedDriverRuntime } from "@mosoo/agent-driver/runtime";
import type { DriverRuntime } from "@mosoo/agent-driver/runtime";
import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig, AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";
import type {
  AgentConfigChangePlan,
  AgentConfigChangeSnapshot,
} from "@mosoo/contracts/agent-config-change-plan";
import type { AgentId, McpServerId, SkillId } from "@mosoo/id";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

import { validationError } from "../../../platform/errors";
import { listEditableAgentSkillReferences } from "./agent-deployment-version.service";
import type { AgentRow } from "./agent-types";

export function requireAgentRuntimeSelection(input: {
  model: string;
  provider: string;
  runtimeId: string;
}): { model: string; provider: string; runtimeId: DriverRuntime } {
  const entry = getRuntimeCatalogEntry(input.runtimeId);

  if (entry === null || !isSupportedDriverRuntime(entry.runtimeId)) {
    throw validationError(`Unsupported runtime: ${input.runtimeId}.`);
  }

  const model = input.model.trim();
  const provider = input.provider.trim();

  if (model === "" || provider === "") {
    throw validationError("Model and provider are required.");
  }

  return { model, provider, runtimeId: entry.runtimeId };
}

export async function listAgentSkillIds(
  database: D1Database,
  agentId: AgentId,
): Promise<SkillId[]> {
  const skills = await listEditableAgentSkillReferences(database, agentId);
  return skills.map((skill) => skill.skillId);
}

export function createAgentConfigChangeSnapshot(input: {
  agent: Pick<AgentRow, "description" | "model" | "name" | "prompt" | "provider" | "runtimeId"> & {
    builtInTools: readonly AgentBuiltInToolConfig[];
    providerOptions: JsonObject;
  };
  environment: AgentEnvironmentConfig;
  mcpServerIds: readonly McpServerId[];
  skillIds: readonly SkillId[];
}): AgentConfigChangeSnapshot {
  return {
    builtInTools: input.agent.builtInTools,
    description: input.agent.description ?? "",
    environmentId: input.environment.environmentId,
    mcpServerIds: input.mcpServerIds,
    model: input.agent.model,
    name: input.agent.name,
    prompt: input.agent.prompt,
    provider: input.agent.provider,
    providerOptions: input.agent.providerOptions,
    runtimeId: input.agent.runtimeId,
    skills: input.skillIds.map((id) => ({ id, state: "active" as const })),
  };
}

export function planVersionedAgentConfigChange(input: {
  agentStatus: AgentRow["status"];
  current: AgentConfigChangeSnapshot;
  next: AgentConfigChangeSnapshot;
}): AgentConfigChangePlan {
  return classifyAgentConfigChanges({
    agentStatus: input.agentStatus,
    current: input.next,
    saved: input.current,
  });
}

export function summarizeVersionedAgentConfigChange(plan: AgentConfigChangePlan): string {
  if (plan.fieldLabels.length === 0) {
    return "Configuration updated";
  }

  return `Preset updated · ${plan.fieldLabels.join(", ")}`;
}
