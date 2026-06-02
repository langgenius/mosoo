import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import type { AgentDeploymentVersionId, AgentId } from "@mosoo/id";

import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";

export interface RuntimeOperationEvent {
  agentId: AgentId;
  deploymentVersionId?: AgentDeploymentVersionId;
  deploymentVersionNumber?: number;
  operation: RuntimeStateOperationName;
  observedAt: string;
  status: "ready" | "updating";
}

export function buildRuntimeStateOperationEvents(input: {
  agentId: AgentId;
  operation: RuntimeStateOperationName;
  readyAt: string;
  startedAt: string;
  targetVersion?: RuntimeOperationTargetVersion | null;
}): [RuntimeOperationEvent, RuntimeOperationEvent] {
  return [
    {
      agentId: input.agentId,
      ...(input.targetVersion
        ? {
            deploymentVersionId: input.targetVersion.id,
            deploymentVersionNumber: input.targetVersion.versionNumber,
          }
        : {}),
      operation: input.operation,
      observedAt: input.startedAt,
      status: "updating",
    },
    {
      agentId: input.agentId,
      ...(input.targetVersion
        ? {
            deploymentVersionId: input.targetVersion.id,
            deploymentVersionNumber: input.targetVersion.versionNumber,
          }
        : {}),
      operation: input.operation,
      observedAt: input.readyAt,
      status: "ready",
    },
  ];
}
