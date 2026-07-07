import { describe, expect, test } from "bun:test";

import type { SessionRunStatus } from "@mosoo/contracts/session-run";

import {
  ACTIVE_SESSION_RUN_STATUSES,
  decideSessionRunTransition,
  isTerminalSessionRunStatus,
  toSessionRunStatusLifecycleEventName,
} from "../src/modules/runtime/domain/session-run-lifecycle.machine";

const ALL_STATUSES = [
  "booting",
  "cancelled",
  "completed",
  "expired",
  "failed",
  "queued",
  "running",
  "waiting_input",
] as const satisfies readonly SessionRunStatus[];

const TERMINAL_STATUSES = ["cancelled", "completed", "expired", "failed"] as const;

const ACCEPTED_TARGETS: Record<SessionRunStatus, SessionRunStatus[]> = {
  booting: ["cancelled", "completed", "expired", "failed", "running", "waiting_input"],
  cancelled: [],
  completed: [],
  expired: [],
  failed: [],
  queued: ["booting", "cancelled", "expired", "failed", "running"],
  running: ["cancelled", "completed", "expired", "failed", "waiting_input"],
  waiting_input: ["cancelled", "completed", "expired", "failed", "running"],
};

describe("decideSessionRunTransition", () => {
  for (const currentStatus of ALL_STATUSES) {
    for (const targetStatus of ALL_STATUSES) {
      const expected =
        currentStatus === targetStatus
          ? "duplicate"
          : (TERMINAL_STATUSES as readonly SessionRunStatus[]).includes(currentStatus)
            ? "stale"
            : ACCEPTED_TARGETS[currentStatus].includes(targetStatus)
              ? "accepted"
              : "rejected";

      test(`${currentStatus} -> ${targetStatus} is ${expected}`, () => {
        const decision = decideSessionRunTransition({ currentStatus, targetStatus });

        expect(decision.kind).toBe(expected);

        if (decision.kind === "accepted") {
          expect(decision.previousStatus).toBe(currentStatus);
          expect(decision.nextStatus).toBe(targetStatus);
        }

        if (decision.kind === "duplicate") {
          expect(decision.currentStatus).toBe(currentStatus);
        }

        if (decision.kind === "rejected") {
          expect(decision.reason).toBe("illegal_transition");
          expect(decision.currentStatus).toBe(currentStatus);
          expect(decision.targetStatus).toBe(targetStatus);
        }

        if (decision.kind === "stale") {
          expect(decision.reason).toBe("terminal_run");
          expect(decision.currentStatus).toBe(currentStatus);
          expect(decision.targetStatus).toBe(targetStatus);
        }

        expect(decision.event.type).toBe(toSessionRunStatusLifecycleEventName(targetStatus));
      });
    }
  }

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
