export type AgentBuilderNodeKey = string;

const AGENT_BUILDER_NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

export function normalizeAgentBuilderNodeKey(value: unknown): AgentBuilderNodeKey | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return AGENT_BUILDER_NODE_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export function isAgentBuilderNodeKey(value: unknown): value is AgentBuilderNodeKey {
  return normalizeAgentBuilderNodeKey(value) !== null;
}
