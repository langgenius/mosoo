import type { AgentBuilderThreadId, AgentId } from "@mosoo/id";

import { parseAgentBuilderThreadId, parseAgentId } from "./agent-builder-ids";

export interface AgentBuilderSystemAgentInstanceIdentity {
  readonly agentId: AgentId;
  readonly threadId: AgentBuilderThreadId;
}

export function parseAgentBuilderSystemAgentInstanceName(
  instanceName: string,
): AgentBuilderSystemAgentInstanceIdentity {
  const decodedInstanceName = decodeURIComponent(instanceName);
  const parts = decodedInstanceName.split(":");

  if (parts.length !== 4 || parts[0] !== "agent" || parts[2] !== "thread") {
    throw new Error(
      "Agent Builder System Agent instance name must be agent:<agentId>:thread:<threadId>.",
    );
  }

  return {
    agentId: parseAgentId(parts[1], "instance agentId"),
    threadId: parseAgentBuilderThreadId(parts[3], "instance threadId"),
  };
}

export function assertAgentBuilderSystemAgentInstanceIdentity(input: {
  readonly bodyAgentId: AgentId;
  readonly bodyThreadId: AgentBuilderThreadId;
  readonly instance: AgentBuilderSystemAgentInstanceIdentity;
}): void {
  if (input.bodyAgentId !== input.instance.agentId) {
    throw new Error("Agent Builder System Agent body agentId does not match the addressed Agent.");
  }

  if (input.bodyThreadId !== input.instance.threadId) {
    throw new Error(
      "Agent Builder System Agent body threadId does not match the addressed thread.",
    );
  }
}
