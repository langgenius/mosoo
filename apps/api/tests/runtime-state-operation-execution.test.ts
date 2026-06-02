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
});
