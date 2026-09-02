import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, RuntimeOperationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { buildRuntimeStateOperationEvents } from "./runtime-state-operation-events";
import {
  publishRuntimeOperationEvent,
  writeRuntimeOperationTimedOutSnapshots,
} from "./runtime-state-operation-target-events";
import { restoreRuntimeOperationFailedTargets } from "./runtime-state-operation-target-recovery";
import {
  claimRuntimeOperationTargets,
  expireStaleRuntimeOperationTargets,
  listRuntimeOperationTargets,
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
  const admissibleTargets = listAdmissibleOperationTargets(input.targets);
  let reschedulingTargets: RuntimeSessionTargetTransition[];

  try {
    reschedulingTargets = await claimRuntimeOperationTargets(bindings.DB, {
      event: updatingEvent,
      operationId,
      targets: admissibleTargets,
    });
  } catch (error) {
    const claimedTargets = await listRuntimeOperationTargets(bindings.DB, {
      operationId,
      targets: admissibleTargets,
    });
    const partialTransitions = claimedTargets.map((current) => ({ current }));
    const [, readyEvent] = buildRuntimeStateOperationEvents({
      agentId: input.agentId,
      operation: input.operation,
      readyAt: new Date().toISOString(),
      startedAt,
      targetVersion: input.targetVersion,
    });

    try {
      await restoreRuntimeOperationFailedTargets(bindings, {
        operationId,
        readyEvent,
        targets: partialTransitions,
        terminalTimestampMs: Date.parse(startedAt),
      });
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "Runtime operation admission and partial-target recovery both failed.",
        { cause: recoveryError },
      );
    }
    throw new Error("Runtime operation admission failed after partial-target recovery.", {
      cause: error,
    });
  }
  await publishRuntimeOperationEvent(bindings, {
    event: updatingEvent,
    operationId,
    targets: listCurrentTargets(reschedulingTargets),
  });

  return {
    operationId,
    reschedulingTargets,
    startedAt,
    targetVersion: input.targetVersion,
  };
}

async function finishRuntimeStateOperationPhase(
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
  const phaseTargets = listRuntimeStateOperationPhaseTargets(input.phase);
  const timedOutTargets = await expireStaleRuntimeOperationTargets(bindings.DB, {
    operationId: input.phase.operationId,
    targets: phaseTargets,
  });
  await writeRuntimeOperationTimedOutSnapshots(bindings, {
    operationId: input.phase.operationId,
    targets: timedOutTargets,
  });
  const timedOutIds = new Set(timedOutTargets.map((target) => target.sessionId));

  await restoreRuntimeOperationFailedTargets(bindings, {
    operationId: input.phase.operationId,
    readyEvent,
    targets: input.phase.reschedulingTargets.filter(
      (target) => !timedOutIds.has(target.current.sessionId),
    ),
    terminalTimestampMs: Date.parse(input.phase.startedAt),
  });
}

export const failRuntimeStateOperationPhase = finishRuntimeStateOperationPhase;
export const completeRuntimeStateOperationPhase = finishRuntimeStateOperationPhase;
