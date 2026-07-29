import { describe, expect, test } from "bun:test";

import { createErrorLogContext, normalizeLogMetadata } from "@mosoo/observability";

import { RuntimeSubjectCheckpointFailedError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-errors";

describe("error log context", () => {
  test("records nested checkpoint causes without expanding non-Error objects", () => {
    const checkpointError = new RuntimeSubjectCheckpointFailedError({
      cause: new Error("sandbox backup upload failed"),
      dir: "/workspace/memory",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    expect(normalizeLogMetadata(createErrorLogContext(checkpointError))).toMatchObject({
      error: {
        cause: {
          message: "sandbox backup upload failed",
          name: "Error",
        },
        message:
          "Runtime subject 01J0000000000000000000000D checkpoint failed for /workspace/memory.",
        name: "RuntimeSubjectCheckpointFailedError",
      },
    });

    const objectCause = new Error("unsafe cause", {
      cause: { token: "must-not-be-logged" },
    });
    const normalized = normalizeLogMetadata(createErrorLogContext(objectCause));
    expect(normalized).toMatchObject({
      error: {
        cause: "[Non-Error cause]",
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("must-not-be-logged");

    const circularCause = new Error("circular cause");
    Object.defineProperty(circularCause, "cause", { value: circularCause });
    expect(normalizeLogMetadata(createErrorLogContext(circularCause))).toMatchObject({
      error: {
        cause: "[Circular]",
      },
    });
  });
});
