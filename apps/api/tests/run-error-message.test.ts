import { describe, expect, test } from "bun:test";

import { describeRunError } from "../src/modules/runtime/application/session-runs/run-error-message";

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
