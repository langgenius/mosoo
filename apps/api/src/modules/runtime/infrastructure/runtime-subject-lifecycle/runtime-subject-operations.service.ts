import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import type { RuntimeOperationId, SandboxId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import { closeRuntimeSubjectSessionsForRecycle } from "./runtime-subject-maintenance-store";
import { destroyRuntimeSubjectContainer } from "./runtime-subject-platform";
import {
  advanceRuntimeSubjectOperationStatus,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
  markRuntimeSubjectOperationRepairNeeded,
} from "./runtime-subject-record-store";

export interface RuntimeSubjectOperationInput {
  operationId: RuntimeOperationId;
  runtimeSubjectId: SandboxId;
  reason: string;
  targets: readonly { readonly sessionId: SessionId }[];
  terminalRun: {
    error?: RunError | null;
    status: Extract<SessionRunStatus, "cancelled" | "failed">;
  };
}

export async function recreateRuntimeSubjectPreservingState(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput,
): Promise<void> {
  let destroyStarted = false;

  const started = await markRuntimeSubjectOperationStarted(bindings.DB, {
    operationId: input.operationId,
    runtimeSubjectId: input.runtimeSubjectId,
    status: "backing_up",
  });

  if (!started) {
    throw new Error("Runtime subject is busy with lifecycle maintenance.");
  }

  try {
    await stopRuntimeSubjectDrivers(bindings, {
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      preserveSessionLifecycle: true,
      reason: input.reason,
      targets: input.targets,
      terminalRun: input.terminalRun,
    });
    destroyStarted = await advanceRuntimeSubjectOperationStatus(bindings.DB, {
      expectedStatus: "backing_up",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      status: "destroying",
    });
    if (!destroyStarted) {
      throw new Error("Runtime subject changed before destroy.");
    }
    await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId);
    await closeRuntimeSubjectSessionsForRecycle(bindings.DB, input.runtimeSubjectId);
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (!completed) {
      throw new Error("Runtime subject changed before recreate completion.");
    }
  } catch (error) {
    await markRuntimeSubjectOperationRepairNeeded(bindings.DB, {
      errorMessage: error instanceof Error ? error.message : "Runtime state operation failed.",
      expectedStatus: destroyStarted ? "destroying" : "backing_up",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    throw error;
  }
}
