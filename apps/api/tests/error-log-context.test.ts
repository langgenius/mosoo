import { describe, expect, spyOn, test } from "bun:test";

import { RuntimeSubjectCheckpointFailedError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-errors";
import { createErrorLogContext, logError } from "../src/platform/cloudflare/logger";

function logErrorEntry(error: unknown): Record<string, unknown> {
  const consoleError = spyOn(console, "error").mockImplementation(() => {});

  try {
    logError("test.error", createErrorLogContext(error));
    return JSON.parse(String(consoleError.mock.calls[0]?.[0]));
  } finally {
    consoleError.mockRestore();
  }
}

describe("error log context", () => {
  test("records nested checkpoint causes without expanding non-Error objects", () => {
    const checkpointError = new RuntimeSubjectCheckpointFailedError({
      cause: new Error("sandbox backup upload failed"),
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    expect(logErrorEntry(checkpointError)).toMatchObject({
      error: {
        cause: {
          message: "sandbox backup upload failed",
          name: "Error",
        },
        message: "Runtime subject 01J0000000000000000000000D checkpoint failed.",
        name: "RuntimeSubjectCheckpointFailedError",
      },
    });

    const objectCause = new Error("unsafe cause", {
      cause: { token: "must-not-be-logged" },
    });
    const objectCauseEntry = logErrorEntry(objectCause);
    expect(objectCauseEntry["error"]).not.toHaveProperty("cause");
    expect(JSON.stringify(objectCauseEntry)).not.toContain("must-not-be-logged");

    const circularCause = new Error("circular cause");
    Object.defineProperty(circularCause, "cause", { value: circularCause });
    expect(logErrorEntry(circularCause)).toMatchObject({
      error: {
        cause: { message: "[Circular Reference]" },
      },
    });
  });
});
