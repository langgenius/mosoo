import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeSubjectOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import {
  closeRuntimeSubjectSessionsForRecycle,
  releaseInactiveRuntimeSubjectClaim,
} from "./runtime-subject-maintenance-store";
import { destroyRuntimeSubjectContainer } from "./runtime-subject-platform";
import {
  advanceRuntimeSubjectOperationStatus,
  assertRuntimeSubjectOperationCurrent,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
  markRuntimeSubjectOperationRepairNeeded,
} from "./runtime-subject-record-store";

async function runRuntimeSubjectRecycleOperation(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly startStatus: RuntimeSubjectOperationStatus;
  },
): Promise<void> {
  let destroyStarted = input.startStatus === "destroying";

  try {
    // `backing_up` means drivers may still be live, so a resumed repair stops
    // them again before destroying the container.
    if (input.startStatus === "backing_up") {
      await stopRuntimeSubjectDrivers(bindings, {
        operationId: input.operationId,
        reason: input.reason,
        runtimeSubjectId: input.runtimeSubjectId,
      });
      destroyStarted = await advanceRuntimeSubjectOperationStatus(bindings.DB, {
        expectedStatus: "backing_up",
        operationId: input.operationId,
        runtimeSubjectId: input.runtimeSubjectId,
        status: "destroying",
      });
      if (!destroyStarted) {
        throw new Error("Runtime subject changed before recycle destroy.");
      }
    }

    await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId);
    await closeRuntimeSubjectSessionsForRecycle(bindings.DB, input.runtimeSubjectId);
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (!completed) {
      throw new Error("Runtime subject changed before recycle completion.");
    }
  } catch (error) {
    await markRuntimeSubjectOperationRepairNeeded(bindings.DB, {
      errorMessage: error instanceof Error ? error.message : "Runtime subject recycle failed.",
      expectedStatus: destroyStarted ? "destroying" : "backing_up",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    throw error;
  }
}

export async function recycleRuntimeSubject(
  bindings: ApiBindings,
  input: {
    readonly claimOwner: string;
    readonly now: number;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const operationId = createPlatformId<RuntimeOperationId>();
  const started = await markRuntimeSubjectOperationStarted(bindings.DB, {
    claimOwner: input.claimOwner,
    now: input.now,
    operationId,
    runtimeSubjectId: input.runtimeSubjectId,
    source: "maintenance",
    status: "backing_up",
  });

  if (!started) {
    await releaseInactiveRuntimeSubjectClaim(bindings.DB, {
      claimOwner: input.claimOwner,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    return false;
  }

  await runRuntimeSubjectRecycleOperation(bindings, {
    operationId,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
    startStatus: "backing_up",
  });

  return true;
}

export async function resumeRuntimeSubjectRecycleOperation(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<boolean> {
  // A stale repair must not stop drivers or destroy a container that a later
  // operation or activation now owns.
  await assertRuntimeSubjectOperationCurrent(bindings.DB, input);
  await runRuntimeSubjectRecycleOperation(bindings, {
    operationId: input.operationId,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
    startStatus: input.status,
  });

  return true;
}
