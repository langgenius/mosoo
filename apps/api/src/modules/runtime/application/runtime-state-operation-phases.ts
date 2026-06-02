import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, RuntimeOperationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { buildRuntimeStateOperationEvents } from "./runtime-state-operation-events";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";
import {
  broadcastRuntimeOperationEvent,
  writeRuntimeOperationInterruptedSnapshots,
  writeRuntimeOperationTimedOutSnapshots,
} from "./runtime-state-operation-target-events";
import { restoreRuntimeOperationFailedTargets } from "./runtime-state-operation-target-recovery";
import {
  expireStaleRuntimeOperationTargets,
  transitionRuntimeTargetSessionStatus,
} from "./runtime-state-operation-target-store";
import type {
  RuntimeSessionTarget,
  RuntimeSessionTargetTransition,
} from "./runtime-state-operation-target-store";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";

export interface RuntimeStateOperationPhase {
  readonly operationId: RuntimeOperationId;
  readonly reschedulingTargets: RuntimeSessionTargetTransition[];
  readonly startedAt: string;
  readonly targetVersion: RuntimeOperationTargetVersion | null;
}

function listCurrentTargets(transitions: readonly RuntimeSessionTargetTransition[]) {
  return transitions.map((transition) => transition.current);
}

export function listRuntimeStateOperationPhaseTargets(
  phase: RuntimeStateOperationPhase,
): RuntimeSessionTarget[] {
  return listCurrentTargets(phase.reschedulingTargets);
}

function listAdmissibleOperationTargets(
  targets: readonly RuntimeSessionTarget[],
): RuntimeSessionTarget[] {
  return targets.filter(
    (target) => target.sessionStatus !== "RESCHEDULING" && target.sessionStatusOperationId === null,
  );
}

async function broadcastOperationPhase(
  bindings: ApiBindings,
  input: {
    readonly event: RuntimeOperationEvent;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
    readonly operationId: RuntimeOperationId;
    readonly status: RuntimeSessionTarget["sessionStatus"];
    readonly targets: RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  const transitions = await transitionRuntimeTargetSessionStatus(bindings.DB, {
    ...(input.expectedStatus ? { expectedStatus: input.expectedStatus } : {}),
    expectedOperationId: input.expectedStatus === undefined ? null : input.operationId,
    operationId: input.operationId,
    status: input.status,
    targets: input.targets,
  });
  await broadcastRuntimeOperationEvent(bindings, {
    event: input.event,
    operationId: input.operationId,
    targets: listCurrentTargets(transitions),
  });
  return transitions;
}

export async function startRuntimeStateOperationPhase(
  bindings: ApiBindings,
  input: {
    readonly agentId: AgentId;
    readonly operation: RuntimeStateOperationName;
    readonly targetVersion: RuntimeOperationTargetVersion | null;
    readonly targets: RuntimeSessionTarget[];
  },
): Promise<RuntimeStateOperationPhase> {
  const operationId = createPlatformId<RuntimeOperationId>();
  const startedAt = new Date().toISOString();
  const [updatingEvent] = buildRuntimeStateOperationEvents({
    agentId: input.agentId,
    operation: input.operation,
    readyAt: startedAt,
    startedAt,
    targetVersion: input.targetVersion,
  });
  const reschedulingTargets = await broadcastOperationPhase(bindings, {
    event: updatingEvent,
    operationId,
    status: "RESCHEDULING",
    targets: listAdmissibleOperationTargets(input.targets),
  });

  return {
    operationId,
    reschedulingTargets,
    startedAt,
    targetVersion: input.targetVersion,
  };
}

export async function failRuntimeStateOperationPhase(
  bindings: ApiBindings,
  input: {
    readonly agentId: AgentId;
    readonly operation: RuntimeStateOperationName;
    readonly phase: RuntimeStateOperationPhase;
  },
): Promise<void> {
  const failedAt = new Date().toISOString();
  const [, failureReadyEvent] = buildRuntimeStateOperationEvents({
    agentId: input.agentId,
    operation: input.operation,
    readyAt: failedAt,
    startedAt: input.phase.startedAt,
    targetVersion: input.phase.targetVersion,
  });

  await restoreRuntimeOperationFailedTargets(bindings, {
    operationId: input.phase.operationId,
    readyEvent: failureReadyEvent,
    targets: input.phase.reschedulingTargets,
  });
}

export async function completeRuntimeStateOperationPhase(
  bindings: ApiBindings,
  input: {
    readonly agentId: AgentId;
    readonly operation: RuntimeStateOperationName;
    readonly phase: RuntimeStateOperationPhase;
  },
): Promise<void> {
  const readyAt = new Date().toISOString();
  const [, readyEvent] = buildRuntimeStateOperationEvents({
    agentId: input.agentId,
    operation: input.operation,
    readyAt,
    startedAt: input.phase.startedAt,
    targetVersion: input.phase.targetVersion,
  });

  const timedOutTargets = await expireStaleRuntimeOperationTargets(bindings.DB, {
    operationId: input.phase.operationId,
    targets: listRuntimeStateOperationPhaseTargets(input.phase),
  });
  await writeRuntimeOperationTimedOutSnapshots(bindings, {
    operationId: input.phase.operationId,
    targets: timedOutTargets,
  });
  const readyTransitions = await transitionRuntimeTargetSessionStatus(bindings.DB, {
    expectedOperationId: input.phase.operationId,
    expectedStatus: "RESCHEDULING",
    status: "IDLE",
    targets: listRuntimeStateOperationPhaseTargets(input.phase),
  });
  await writeRuntimeOperationInterruptedSnapshots(bindings, {
    operationId: input.phase.operationId,
    targets: readyTransitions.map((transition) => transition.previous),
  });
  await broadcastRuntimeOperationEvent(bindings, {
    event: readyEvent,
    operationId: input.phase.operationId,
    targets: listCurrentTargets(readyTransitions),
  });
}
