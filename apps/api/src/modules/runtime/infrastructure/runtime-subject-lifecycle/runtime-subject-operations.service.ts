import type { SandboxId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeSubjectOperationInput } from "../../application/execution-plane/execution-plane-adapter";
import {
  appendOneRuntimeDiagnosticEventPerSession,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import { appendRuntimeSubjectTerminatedEvents } from "../../application/runtime-state-operation-target-events";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { createSandboxCheckpoints } from "../sandbox-backup.service";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import {
  getRuntimeSubjectErrorCode,
  getRuntimeSubjectOperationErrorCode,
  RuntimeSubjectCheckpointFailedError,
} from "./runtime-subject-errors";
import {
  clearRuntimeSubjectAgentState,
  destroyRuntimeSubjectContainer,
} from "./runtime-subject-platform";
import {
  advanceRuntimeSubjectOperationStatus,
  closeRuntimeSubjectSessionsForRecycle,
  getRuntimeSubject,
  listRuntimeSubjectSessionStateTargets,
  markRuntimeSubjectCold,
  markRuntimeSubjectFailed,
  markRuntimeSubjectOperationStarted,
} from "./runtime-subject-store";

export { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";

function getRuntimeOperationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime state operation failed.";
}

async function appendCheckpointFailureDiagnostics(
  bindings: ApiBindings,
  input: {
    readonly error: unknown;
    readonly runtimeSubjectId: SandboxId;
    readonly targets: RuntimeSubjectOperationInput["targets"];
  },
): Promise<void> {
  const errorCode = getRuntimeSubjectErrorCode(input.error);

  if (errorCode !== "runtime.subject_checkpoint_failed") {
    return;
  }

  await appendOneRuntimeDiagnosticEventPerSession(bindings, {
    events: input.targets.flatMap((target) => {
      if (target.agentId === null) {
        return [];
      }

      return [
        {
          eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxCheckpointFailed.name,
          sessionId: target.sessionId,
          value: {
            ...toRuntimeDiagnosticBaseValue({
              agentId: target.agentId,
              sessionId: target.sessionId,
            }),
            backupId:
              input.error instanceof RuntimeSubjectCheckpointFailedError
                ? input.error.backupId
                : null,
            dir:
              input.error instanceof RuntimeSubjectCheckpointFailedError ? input.error.dir : null,
            errorCode,
            reason: toRuntimeDiagnosticReason(input.error, "Runtime subject checkpoint failed."),
            sandboxId: input.runtimeSubjectId,
          },
        },
      ];
    }),
  });
}

async function appendTerminatedEventsForRuntimeSubject(
  bindings: ApiBindings,
  input: {
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly targets: RuntimeSubjectOperationInput["targets"];
  },
): Promise<void> {
  await appendRuntimeSubjectTerminatedEvents(bindings, {
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
    targets: input.targets,
  });
}

export async function recreateRuntimeSubjectPreservingState(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput,
): Promise<void> {
  const subject = await getRuntimeSubject(bindings.DB, input.runtimeSubjectId);

  if (!subject) {
    return;
  }

  let destroyStarted = false;

  const policy = getRuntimeKindPolicy(subject.kind);
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
    await createSandboxCheckpoints(bindings, {
      operationId: input.operationId,
      rules: policy.checkpoint.createOnRecreate,
      sandboxId: input.runtimeSubjectId,
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
    await appendTerminatedEventsForRuntimeSubject(bindings, {
      reason: input.reason,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
    await closeRuntimeSubjectSessionsForRecycle(bindings.DB, input.runtimeSubjectId);
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      clearBackups: policy.checkpoint.createOnRecreate.length === 0,
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (!completed) {
      throw new Error("Runtime subject changed before recreate completion.");
    }
  } catch (error) {
    await appendCheckpointFailureDiagnostics(bindings, {
      error,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
    await markRuntimeSubjectFailed(bindings.DB, {
      errorCode: getRuntimeSubjectOperationErrorCode(error),
      errorMessage: getRuntimeOperationErrorMessage(error),
      expectedStatus: destroyStarted ? "destroying" : "backing_up",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      status: "error",
    });
    throw error;
  }
}

export async function resetRuntimeSubjectAgentState(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput,
): Promise<void> {
  const subject = await getRuntimeSubject(bindings.DB, input.runtimeSubjectId);

  if (!subject) {
    return;
  }

  const policy = getRuntimeKindPolicy(subject.kind);

  if (!policy.operations.resetSubjectState) {
    throw new Error("This runtime kind does not have resettable subject state.");
  }

  const started = await markRuntimeSubjectOperationStarted(bindings.DB, {
    operationId: input.operationId,
    runtimeSubjectId: input.runtimeSubjectId,
    status: "destroying",
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
    const stateTargets = await listRuntimeSubjectSessionStateTargets(bindings.DB, {
      runtimeSubjectId: input.runtimeSubjectId,
      sessionIds: input.targets.map((target) => target.sessionId),
    });
    await clearRuntimeSubjectAgentState(bindings, {
      runtimeSubjectId: input.runtimeSubjectId,
      rules: policy.checkpoint.clearOnReset,
      stateTargets,
    });
    await createSandboxCheckpoints(bindings, {
      operationId: input.operationId,
      rules: policy.checkpoint.createOnReset,
      sandboxId: input.runtimeSubjectId,
    });
    await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId);
    await appendTerminatedEventsForRuntimeSubject(bindings, {
      reason: input.reason,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
    await closeRuntimeSubjectSessionsForRecycle(bindings.DB, input.runtimeSubjectId);
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      clearBackups: true,
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (!completed) {
      throw new Error("Runtime subject changed before reset completion.");
    }
  } catch (error) {
    await appendCheckpointFailureDiagnostics(bindings, {
      error,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
    await markRuntimeSubjectFailed(bindings.DB, {
      errorCode: getRuntimeSubjectOperationErrorCode(error),
      errorMessage: getRuntimeOperationErrorMessage(error),
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      status: "error",
    });
    throw error;
  }
}
