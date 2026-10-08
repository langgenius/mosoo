import { describe, expect, test } from "bun:test";

import {
  describeRunError,
  toProvisionRunError,
} from "../src/modules/runtime/application/session-runs/run-error-message";
import { RuntimeSubjectCapacityExceededError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-errors";

describe("describeRunError", () => {
  test("returns the fallback for non-error values", () => {
    expect(describeRunError("boom", "Fallback message.")).toBe("Fallback message.");
    expect(describeRunError(null, "Fallback message.")).toBe("Fallback message.");
  });

  test("returns the message for a plain error", () => {
    expect(describeRunError(new Error("dispatch exploded"), "Fallback message.")).toBe(
      "dispatch exploded",
    );
  });

  test("appends the cause chain to the message", () => {
    const sqlite = new Error(
      "D1_ERROR: UNIQUE constraint failed: session_run_skill.session_run_id, session_run_skill.skill_id",
    );
    const query = new Error('Failed query: insert into "session_run_skill" (...)', {
      cause: sqlite,
    });

    expect(describeRunError(query, "Fallback message.")).toBe(
      'Failed query: insert into "session_run_skill" (...); caused by: D1_ERROR: UNIQUE constraint failed: session_run_skill.session_run_id, session_run_skill.skill_id',
    );
  });

  test("survives cyclic cause chains", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(describeRunError(first, "Fallback message.")).toBe("first; caused by: second");
  });

  test("falls back when every message in the chain is blank", () => {
    expect(describeRunError(new Error(""), "Fallback message.")).toBe("Fallback message.");
  });
});

describe("toProvisionRunError", () => {
  test("reports a full deployment as retryable capacity, even when wrapped", () => {
    const capacity = new RuntimeSubjectCapacityExceededError({ limit: 50, scope: "platform" });

    expect(toProvisionRunError(new Error("activation failed", { cause: capacity }))).toEqual({
      code: "runtime.capacity_exhausted",
      details: { limit: 50, scope: "platform" },
      message: "mosoo is at capacity right now. Try again in a few minutes.",
      retryable: true,
    });
  });

  test("names the account quota the caller reached", () => {
    expect(
      toProvisionRunError(new RuntimeSubjectCapacityExceededError({ limit: 5, scope: "account" })),
    ).toMatchObject({
      code: "runtime.capacity_exhausted",
      message:
        "You already have 5 active sessions. Try again in a few minutes, after one of them finishes.",
      retryable: true,
    });
  });

  test("keeps other provisioning failures terminal", () => {
    expect(toProvisionRunError(new Error("image pull failed"))).toEqual({
      code: "runtime.provision_failed",
      details: {},
      message: "image pull failed",
      retryable: false,
    });
  });
});
