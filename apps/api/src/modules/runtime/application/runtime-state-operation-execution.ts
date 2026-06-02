import type { RuntimeStateOperationName } from "@mosoo/contracts/agent";
import type { RuntimeOperationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { RuntimeExecutionPlaneAdapter } from "./execution-plane/execution-plane-adapter";
import { RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR } from "./runtime-state-operation-errors";
import type { RuntimeOperationSubject } from "./runtime-state-operation-subjects";

export type RuntimeStateOperationExecutionPlane = Pick<
  RuntimeExecutionPlaneAdapter,
  "recreateSubjectPreservingState" | "resetSubjectAgentState" | "stopSubjectDrivers"
>;

const RUNTIME_OPERATION_SUBJECT_CONCURRENCY = 4;

function operationInput(input: RuntimeOperationSubject & { operationId: RuntimeOperationId }) {
  return {
    operationId: input.operationId,
    runtimeSubjectId: input.runtimeSubjectId,
    reason: "agent.runtime_state_operation",
    targets: input.targets,
    terminalRun: {
      error: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
      status: "cancelled" as const,
    },
  };
}

async function executeRuntimeStateOperationSubject(
  executionPlane: RuntimeStateOperationExecutionPlane,
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly operation: RuntimeStateOperationName;
  } & RuntimeOperationSubject,
): Promise<void> {
  switch (input.operation) {
    case "restartDriver": {
      await executionPlane.stopSubjectDrivers(bindings, {
        ...operationInput(input),
        preserveSessionLifecycle: true,
      });
      return;
    }
    case "recreateSandbox": {
      await executionPlane.recreateSubjectPreservingState(bindings, operationInput(input));
      return;
    }
    case "resetAgentState": {
      await executionPlane.resetSubjectAgentState(bindings, operationInput(input));
      return;
    }
    default: {
      throw new Error("Unsupported runtime state operation.");
    }
  }
}

export async function executeRuntimeStateOperationSubjects(
  bindings: ApiBindings,
  input: {
    readonly executionPlane: RuntimeStateOperationExecutionPlane;
    readonly operationId: RuntimeOperationId;
    readonly operation: RuntimeStateOperationName;
    readonly subjects: readonly RuntimeOperationSubject[];
  },
): Promise<void> {
  for (
    let index = 0;
    index < input.subjects.length;
    index += RUNTIME_OPERATION_SUBJECT_CONCURRENCY
  ) {
    await Promise.all(
      input.subjects.slice(index, index + RUNTIME_OPERATION_SUBJECT_CONCURRENCY).map((subject) =>
        executeRuntimeStateOperationSubject(input.executionPlane, bindings, {
          operationId: input.operationId,
          operation: input.operation,
          runtimeSubjectId: subject.runtimeSubjectId,
          targets: subject.targets,
        }),
      ),
    );
  }
}
