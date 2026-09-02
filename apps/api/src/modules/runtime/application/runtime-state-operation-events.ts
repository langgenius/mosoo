import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import type { AgentDeploymentVersionId, AgentId, RuntimeOperationId, SessionId } from "@mosoo/id";

import { createSessionRuntimeEvent } from "../../sessions/application/session-event-write.service";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";

export interface RuntimeOperationEvent {
  agentId: AgentId;
  deploymentVersionId?: AgentDeploymentVersionId;
  deploymentVersionNumber?: number;
  operation: RuntimeStateOperationName;
  observedAt: string;
  status: "ready" | "updating";
}

export function createRuntimeOperationSessionEvent(input: {
  readonly event: RuntimeOperationEvent;
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
}) {
  const occurredAtMs = Date.parse(input.event.observedAt);

  return createSessionRuntimeEvent({
    kind: "agent.task.updated",
    ...(Number.isFinite(occurredAtMs) ? { occurredAtMs } : {}),
    payload: {
      agentId: input.event.agentId,
      ...(input.event.deploymentVersionId
        ? {
            deploymentVersionId: input.event.deploymentVersionId,
            deploymentVersionNumber: input.event.deploymentVersionNumber,
          }
        : {}),
      operation: input.event.operation,
      operationId: input.operationId,
      ...(input.event.status === "ready"
        ? { readyAt: input.event.observedAt }
        : { startedAt: input.event.observedAt }),
      status: input.event.status,
    },
    sessionId: input.sessionId,
    sourceEventId: `runtime-operation:${input.operationId}:${input.sessionId}:${input.event.status}`,
  });
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
