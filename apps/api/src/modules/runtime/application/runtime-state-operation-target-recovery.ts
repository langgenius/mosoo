import type { RuntimeOperationId, SessionRunId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { getSessionRunSummariesByIds } from "../infrastructure/session-runs/session-run-store.repository";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";
import {
  broadcastRuntimeOperationEvent,
  writeRuntimeOperationInterruptedSnapshots,
} from "./runtime-state-operation-target-events";
import {
  isTerminalRunStatus,
  transitionRuntimeTargetSessionStatus,
} from "./runtime-state-operation-target-store";
import type {
  RuntimeSessionTarget,
  RuntimeSessionTargetTransition,
} from "./runtime-state-operation-target-store";

type RuntimeTargetGroups = Record<RuntimeSessionTarget["sessionStatus"], RuntimeSessionTarget[]>;
type RuntimeTargetTransitionGroups = Record<
  RuntimeSessionTarget["sessionStatus"],
  RuntimeSessionTargetTransition[]
>;
const RUNTIME_TARGET_SESSION_STATUSES = ["IDLE", "RESCHEDULING", "RUNNING"] as const;

function createRuntimeTargetGroups(): RuntimeTargetGroups {
  return {
    IDLE: [],
    RESCHEDULING: [],
    RUNNING: [],
  };
}

function createRuntimeTargetTransitionGroups(): RuntimeTargetTransitionGroups {
  return {
    IDLE: [],
    RESCHEDULING: [],
    RUNNING: [],
  };
}

async function groupFailureRestoreTargets(
  bindings: ApiBindings,
  targets: readonly RuntimeSessionTargetTransition[],
): Promise<RuntimeTargetTransitionGroups> {
  const runIds: SessionRunId[] = [];

  for (const { previous: target } of targets) {
    if (target.sessionStatus === "RUNNING" && isTruthy(target.lastRunId)) {
      runIds.push(target.lastRunId);
    }
  }

  const runsById = await getSessionRunSummariesByIds(bindings.DB, runIds);
  const groups = createRuntimeTargetTransitionGroups();

  for (const target of targets) {
    const previous = target.previous;

    if (previous.sessionStatus === "IDLE" || previous.sessionStatus === "RESCHEDULING") {
      groups[previous.sessionStatus].push(target);
      continue;
    }

    if (!isTruthy(previous.lastRunId)) {
      groups.IDLE.push(target);
      continue;
    }

    const run = runsById.get(previous.lastRunId);
    groups[run && !isTerminalRunStatus(run.status) ? "RUNNING" : "IDLE"].push(target);
  }

  return groups;
}

export async function restoreRuntimeOperationFailedTargets(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly readyEvent: RuntimeOperationEvent;
    readonly targets: readonly RuntimeSessionTargetTransition[];
  },
): Promise<RuntimeSessionTarget[]> {
  const restoreGroups = await groupFailureRestoreTargets(bindings, input.targets);
  const restoredTargets: RuntimeSessionTarget[] = [];
  const restoredGroups = createRuntimeTargetGroups();

  const restoredEntries = await Promise.all(
    RUNTIME_TARGET_SESSION_STATUSES.map(async (status) => {
      const transitions = await transitionRuntimeTargetSessionStatus(bindings.DB, {
        expectedOperationId: input.operationId,
        expectedStatus: "RESCHEDULING",
        status,
        targets: restoreGroups[status].map((target) => target.current),
      });
      const updatedTargets = transitions.map((transition) => transition.current);

      return [status, updatedTargets] as const;
    }),
  );

  for (const [status, updatedTargets] of restoredEntries) {
    restoredGroups[status] = updatedTargets;
    restoredTargets.push(...updatedTargets);
  }

  await writeRuntimeOperationInterruptedSnapshots(bindings, {
    operationId: input.operationId,
    targets: input.targets.map((target) => target.previous),
  });

  await broadcastRuntimeOperationEvent(bindings, {
    event: input.readyEvent,
    operationId: input.operationId,
    targets: restoredGroups.IDLE,
  });

  const runningEvent: RuntimeOperationEvent = {
    ...input.readyEvent,
    observedAt: new Date().toISOString(),
    status: "ready",
  };
  await broadcastRuntimeOperationEvent(bindings, {
    event: runningEvent,
    operationId: input.operationId,
    targets: restoredGroups.RUNNING,
  });

  return restoredTargets;
}
