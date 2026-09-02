import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import { parsePlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, AgentId, RuntimeOperationId, SessionId } from "@mosoo/id";
import { stringifyRuntimeEventSemanticValue } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { readSessionRuntimeEventSemanticAuthority } from "../../sessions/domain/session-runtime-event-authority";
import { createSessionRuntimeEventProjection } from "../../sessions/domain/session-runtime-event-projection";

export type RuntimeOperationEventStatus = "ready" | "updating";

export interface RuntimeOperationEventIdentity {
  readonly agentId: AgentId;
  readonly deploymentVersionId: AgentDeploymentVersionId | null;
  readonly deploymentVersionNumber: number | null;
  readonly operation: RuntimeStateOperationName;
}

const runtimeStateOperationNames = new Set<RuntimeStateOperationName>([
  "recreateSandbox",
  "resetAgentState",
  "restartDriver",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalError(input: {
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
  readonly status: RuntimeOperationEventStatus;
}): Error {
  return new Error(
    `Runtime operation ${input.status} source runtime-operation:${input.operationId}:${input.sessionId}:${input.status} is not canonical.`,
  );
}

export function readRuntimeOperationEventIdentity(
  event: RuntimeEventEnvelope,
  input: {
    readonly agentId: AgentId;
    readonly operationId: RuntimeOperationId;
    readonly sessionId: SessionId;
    readonly status: RuntimeOperationEventStatus;
  },
): RuntimeOperationEventIdentity {
  const sourceEventId = `runtime-operation:${input.operationId}:${input.sessionId}:${input.status}`;
  if (
    event.actor !== "api" ||
    event.delivery !== "lossless" ||
    event.kind !== "agent.task.updated" ||
    event.origin !== "api" ||
    event.sessionId !== input.sessionId ||
    event.sourceEventId !== sourceEventId ||
    event.visibility !== "participant" ||
    event.context !== undefined ||
    event.correlationId !== undefined ||
    event.driverInstanceId !== undefined ||
    event.native !== undefined ||
    event.receivedAt !== undefined ||
    event.runId !== undefined ||
    event.runtimeId !== undefined ||
    event.seq !== undefined ||
    event.traceId !== undefined ||
    !isRecord(event.payload)
  ) {
    throw canonicalError(input);
  }

  const payload = event.payload;
  const timingField = input.status === "ready" ? "readyAt" : "startedAt";
  const allowedKeys = new Set([
    "agentId",
    "deploymentVersionId",
    "deploymentVersionNumber",
    "operation",
    "operationId",
    "status",
    timingField,
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw canonicalError(input);
  }

  let agentId: AgentId;
  let deploymentVersionId: AgentDeploymentVersionId | null = null;
  let operationId: RuntimeOperationId;
  try {
    agentId = parsePlatformId<AgentId>(payload["agentId"], "Runtime operation Agent ID");
    operationId = parsePlatformId<RuntimeOperationId>(
      payload["operationId"],
      "Runtime operation ID",
    );
    if (payload["deploymentVersionId"] !== undefined) {
      deploymentVersionId = parsePlatformId<AgentDeploymentVersionId>(
        payload["deploymentVersionId"],
        "Runtime operation deployment version ID",
      );
    }
  } catch {
    throw canonicalError(input);
  }

  const operation = payload["operation"];
  const observedAt = payload[timingField];
  const hasDeploymentVersion = payload["deploymentVersionId"] !== undefined;
  const deploymentVersionNumber = payload["deploymentVersionNumber"];
  if (
    agentId !== input.agentId ||
    operationId !== input.operationId ||
    typeof operation !== "string" ||
    !runtimeStateOperationNames.has(operation as RuntimeStateOperationName) ||
    payload["status"] !== input.status ||
    typeof observedAt !== "string" ||
    observedAt !== event.occurredAt ||
    !Number.isFinite(Date.parse(observedAt)) ||
    hasDeploymentVersion !== (deploymentVersionNumber !== undefined) ||
    (hasDeploymentVersion &&
      (!Number.isSafeInteger(deploymentVersionNumber) || (deploymentVersionNumber as number) <= 0))
  ) {
    throw canonicalError(input);
  }

  return {
    agentId,
    deploymentVersionId,
    deploymentVersionNumber: hasDeploymentVersion ? (deploymentVersionNumber as number) : null,
    operation: operation as RuntimeStateOperationName,
  };
}

export function createRuntimeOperationEventAuthorityJson(input: {
  readonly agentId: AgentId;
  readonly event: RuntimeEventEnvelope;
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
  readonly status: RuntimeOperationEventStatus;
}): string {
  readRuntimeOperationEventIdentity(input.event, input);
  return stringifyRuntimeEventSemanticValue(input.event);
}

export async function readRuntimeOperationEventAuthority(input: {
  readonly agentId: AgentId;
  readonly eventId: string;
  readonly eventJson: string | null;
  readonly eventType: string;
  readonly occurredAt: number;
  readonly operationId: RuntimeOperationId;
  readonly rowAgentId: AgentId;
  readonly semanticHash: string | null;
  readonly sessionId: SessionId;
  readonly source: string;
  readonly sourceEventId: string;
  readonly status: RuntimeOperationEventStatus;
  readonly visibility: string;
}): Promise<{
  readonly agentId: AgentId;
  readonly deploymentVersionId: AgentDeploymentVersionId | null;
  readonly deploymentVersionNumber: number | null;
  readonly event: RuntimeEventEnvelope;
  readonly occurredAt: number;
  readonly operation: RuntimeStateOperationName;
}> {
  const sourceEventId = `runtime-operation:${input.operationId}:${input.sessionId}:${input.status}`;
  const event = await readSessionRuntimeEventSemanticAuthority({
    eventJson: input.eventJson,
    invalidMessage: `Runtime operation ${input.status} source ${sourceEventId} is not canonical.`,
    missingMessage: `Runtime operation ${input.status} source ${sourceEventId} has no semantic authority.`,
    semanticHash: input.semanticHash,
  });
  const identity = readRuntimeOperationEventIdentity(event, input);
  const projection = createSessionRuntimeEventProjection(event);

  if (
    input.rowAgentId !== input.agentId ||
    event.id !== input.eventId ||
    event.kind !== input.eventType ||
    Date.parse(event.occurredAt) !== input.occurredAt ||
    event.sourceEventId !== input.sourceEventId ||
    input.sourceEventId !== sourceEventId ||
    projection.eventType !== input.eventType ||
    projection.runId !== null ||
    projection.source !== input.source ||
    projection.source !== "api" ||
    projection.traceId !== null ||
    projection.visibility !== input.visibility ||
    projection.visibility !== "all_consumers"
  ) {
    throw canonicalError(input);
  }

  return { ...identity, event, occurredAt: input.occurredAt };
}
