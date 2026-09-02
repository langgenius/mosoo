import { describe, expect, test } from "bun:test";

import { executeRuntimeStateOperationSubjects } from "../src/modules/runtime/application/runtime-state-operation-execution";
import type { RuntimeStateOperationExecutionPlane } from "../src/modules/runtime/application/runtime-state-operation-execution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

describe("runtime state operation execution", () => {
  test("starts independent runtime subjects before awaiting the first subject", async () => {
    const startedRuntimeSubjectIds: string[] = [];
    const operationIds: string[] = [];
    const plane: RuntimeStateOperationExecutionPlane = {
      async recreateSubjectPreservingState() {
        throw new Error("Unexpected recreate operation.");
      },
      async resetSubjectAgentState() {
        throw new Error("Unexpected reset operation.");
      },
      async stopSubjectDrivers(_bindings, input) {
        startedRuntimeSubjectIds.push(input.runtimeSubjectId);
        operationIds.push(input.operationId ?? "");
        await Promise.resolve();
      },
    };

    const operation = executeRuntimeStateOperationSubjects({} as ApiBindings, {
      executionPlane: plane,
      operation: "restartDriver",
      operationId: "01J0000000000000000000000R",
      subjects: [
        { runtimeSubjectId: "01J0000000000000000000000D", targets: [] },
        { runtimeSubjectId: "sandbox-2", targets: [] },
      ],
    });
    const startedBeforeFirstSubjectSettles = [...startedRuntimeSubjectIds];

    await operation;

    expect(startedBeforeFirstSubjectSettles).toEqual(["01J0000000000000000000000D", "sandbox-2"]);
    expect(startedRuntimeSubjectIds).toEqual(["01J0000000000000000000000D", "sandbox-2"]);
    expect(operationIds).toEqual(["01J0000000000000000000000R", "01J0000000000000000000000R"]);
  });

  test("joins every started subject before exposing a sibling failure", async () => {
    const delayed = Promise.withResolvers<void>();
    let delayedSubjectFinished = false;
    let operationRejected = false;
    const plane: RuntimeStateOperationExecutionPlane = {
      async recreateSubjectPreservingState() {
        throw new Error("Unexpected recreate operation.");
      },
      async resetSubjectAgentState() {
        throw new Error("Unexpected reset operation.");
      },
      async stopSubjectDrivers(_bindings, input) {
        if (input.runtimeSubjectId === "failing-subject") {
          throw new Error("subject failed");
        }
        await delayed.promise;
        delayedSubjectFinished = true;
      },
    };
    const operation = executeRuntimeStateOperationSubjects({} as ApiBindings, {
      executionPlane: plane,
      operation: "restartDriver",
      operationId: "01J0000000000000000000000R",
      subjects: [
        { runtimeSubjectId: "failing-subject", targets: [] },
        { runtimeSubjectId: "delayed-subject", targets: [] },
      ],
    }).catch((error: unknown) => {
      operationRejected = true;
      throw error;
    });

    await Promise.resolve();
    expect(operationRejected).toBe(false);
    delayed.resolve();

    await expect(operation).rejects.toThrow("subject failed");
    expect(delayedSubjectFinished).toBe(true);
  });
});
