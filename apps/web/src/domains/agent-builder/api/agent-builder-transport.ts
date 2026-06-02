import type { AgentBuilderThreadId, AgentId } from "@mosoo/contracts/id";

export interface AgentBuilderSystemAgentAddress {
  agent: "agent-builder-system-agent";
  basePath: string;
  instanceName: string;
  publicPath: string;
  threadId: AgentBuilderThreadId;
}

const AGENT_BUILDER_SYSTEM_AGENT_NAME = "agent-builder-system-agent";
const AGENT_BUILDER_SYSTEM_AGENT_BASE_PATH = "api/agents/agent-builder-system-agent";

export function createAgentBuilderSystemAgentInstanceName(input: {
  agentId: AgentId;
  threadId: AgentBuilderThreadId;
}): string {
  const agentId = normalizeRequiredIdentifier("agentId", input.agentId);
  const threadId = normalizeRequiredIdentifier("threadId", input.threadId);

  return `agent:${agentId}:thread:${threadId}`;
}

export function createAgentBuilderSystemAgentAddress(input: {
  agentId: AgentId;
  threadId: AgentBuilderThreadId;
}): AgentBuilderSystemAgentAddress {
  const instanceName = createAgentBuilderSystemAgentInstanceName(input);
  const encodedInstanceName = encodeURIComponent(instanceName);
  const basePath = `${AGENT_BUILDER_SYSTEM_AGENT_BASE_PATH}/${encodedInstanceName}`;

  return {
    agent: AGENT_BUILDER_SYSTEM_AGENT_NAME,
    basePath,
    instanceName,
    publicPath: `/${basePath}`,
    threadId: input.threadId,
  };
}

export function resolveAgentBuilderSystemAgentAddress(input: {
  agentId: AgentId;
  threadId?: AgentBuilderThreadId | null;
}): AgentBuilderSystemAgentAddress | null {
  if (input.threadId === null || input.threadId === undefined || input.threadId.trim() === "") {
    return null;
  }

  return createAgentBuilderSystemAgentAddress({
    agentId: input.agentId,
    threadId: input.threadId,
  });
}

function normalizeRequiredIdentifier(fieldName: string, value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`Agent Builder transport requires ${fieldName}.`);
  }

  return normalizedValue;
}
