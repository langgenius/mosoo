import type { EnvironmentId, McpServerId, SkillId } from "../id/id.contract";
import type { JsonObject } from "../validation/primitives.contract";
import type { AgentBuiltInToolConfig, AgentStatus } from "./agent.contract";

export interface AgentConfigChangeSkill {
  id: SkillId;
  state?: "active" | "tombstone";
}

export interface AgentConfigChangeSnapshot {
  builtInTools: readonly AgentBuiltInToolConfig[];
  description: string;
  environmentId: EnvironmentId | null;
  mcpServerIds: readonly McpServerId[];
  model: string;
  name: string;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  runtimeId: string;
  skills: readonly AgentConfigChangeSkill[];
}

export interface AgentConfigChangePlan {
  fieldLabels: string[];
  /** Compatibility record for existing published v1 consumers; no Session mutation. */
  requiresDeploymentVersion: boolean;
}

const FIELD_LABELS: Record<keyof AgentConfigChangeSnapshot, string> = {
  name: "Name",
  description: "Description",
  prompt: "System prompt",
  mcpServerIds: "MCP Servers",
  model: "Model",
  provider: "Provider",
  providerOptions: "Advanced settings",
  builtInTools: "Built-in tools",
  skills: "Skills",
  environmentId: "Environment",
  runtimeId: "Runtime",
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "undefined";
}

export function classifyAgentConfigChanges(input: {
  agentStatus: AgentStatus;
  current: AgentConfigChangeSnapshot;
  saved: AgentConfigChangeSnapshot;
}): AgentConfigChangePlan {
  const fields = (Object.keys(FIELD_LABELS) as (keyof AgentConfigChangeSnapshot)[]).filter(
    (field) => stableStringify(input.current[field]) !== stableStringify(input.saved[field]),
  );
  return {
    fieldLabels: fields.map((field) => FIELD_LABELS[field]),
    requiresDeploymentVersion:
      input.agentStatus === "published" &&
      fields.some((field) => field !== "name" && field !== "description"),
  };
}
