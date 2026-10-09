import { describe, expect, test } from "bun:test";

import {
  ACTIVE_SESSION_RUN_STATUSES,
  decideSessionRunTransition,
  isTerminalSessionRunStatus,
} from "../src/modules/runtime/domain/session-run-lifecycle.machine";

const TERMINAL_STATUSES = ["cancelled", "completed", "expired", "failed"] as const;

describe("decideSessionRunTransition", () => {
  test("classifies duplicate, stale, illegal and accepted transitions", () => {
    expect(
      decideSessionRunTransition({ currentStatus: "running", targetStatus: "running" }),
    ).toEqual({ currentStatus: "running", kind: "duplicate" });
    expect(
      decideSessionRunTransition({ currentStatus: "completed", targetStatus: "running" }),
    ).toEqual({
      currentStatus: "completed",
      kind: "stale",
      reason: "terminal_run",
      targetStatus: "running",
    });
    expect(
      decideSessionRunTransition({ currentStatus: "queued", targetStatus: "completed" }),
    ).toEqual({
      currentStatus: "queued",
      kind: "rejected",
      reason: "illegal_transition",
      targetStatus: "completed",
    });
    expect(
      decideSessionRunTransition({ currentStatus: "waiting_input", targetStatus: "running" }),
    ).toEqual({ kind: "accepted" });
  });

  test("no active status accepts a transition back to queued", () => {
    for (const currentStatus of ACTIVE_SESSION_RUN_STATUSES) {
      if (currentStatus === "queued") {
        continue;
      }

      const decision = decideSessionRunTransition({ currentStatus, targetStatus: "queued" });
      expect(decision.kind).toBe("rejected");
    }
  });
});

describe("isTerminalSessionRunStatus", () => {
  for (const status of TERMINAL_STATUSES) {
    test(`${status} is terminal`, () => {
      expect(isTerminalSessionRunStatus(status)).toBe(true);
    });
  }

  for (const status of ACTIVE_SESSION_RUN_STATUSES) {
    test(`${status} is not terminal`, () => {
      expect(isTerminalSessionRunStatus(status)).toBe(false);
    });
  }

  test("null is not terminal", () => {
    expect(isTerminalSessionRunStatus(null)).toBe(false);
  });
});
