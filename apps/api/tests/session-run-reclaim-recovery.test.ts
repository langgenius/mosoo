import { describe, expect, test } from "bun:test";

import type { SessionRunStatus, SessionRunTrigger } from "@mosoo/contracts/session-run";

import {
  classifyReclaim,
  decideReclaimRecovery,
} from "../src/modules/runtime/domain/session-run-reclaim-recovery";
import type {
  DriverTerminalStatus,
  ReclaimReason,
} from "../src/modules/runtime/domain/session-run-reclaim-recovery";

describe("classifyReclaim", () => {
  const cases: Array<{
    reclaimReason: ReclaimReason;
    driverTerminalStatus: DriverTerminalStatus | null;
    code: string;
  }> = [
    {
      code: "runtime.turn_interrupted",
      driverTerminalStatus: "stopped",
      reclaimReason: "socket_closed",
    },
    {
      code: "runtime.driver_failed",
      driverTerminalStatus: "failed",
      reclaimReason: "socket_closed",
    },
    { code: "runtime.driver_failed", driverTerminalStatus: null, reclaimReason: "socket_closed" },
    {
      code: "runtime.driver_stopped",
      driverTerminalStatus: "failed",
      reclaimReason: "heartbeat_stale",
    },
    {
      code: "runtime.driver_stopped",
      driverTerminalStatus: "stopped",
      reclaimReason: "heartbeat_stale",
    },
    { code: "runtime.inactive", driverTerminalStatus: null, reclaimReason: "heartbeat_stale" },
  ];

  for (const { reclaimReason, driverTerminalStatus, code } of cases) {
    test(`${reclaimReason} + ${driverTerminalStatus ?? "inactive"} -> ${code}`, () => {
      const error = classifyReclaim({ driverTerminalStatus, reclaimReason });
      expect(error.code).toBe(code);
      // The whole point: every reclaim path is retryable, so the sync path and
      // the sweep path no longer disagree for the same physical eviction.
      expect(error.retryable).toBe(true);
    });
  }

  test("prefers the driver-reported error message when present", () => {
    const error = classifyReclaim({
      driverErrorMessage: "container OOM-killed",
      driverTerminalStatus: "failed",
      reclaimReason: "heartbeat_stale",
    });
    expect(error.message).toBe("container OOM-killed");
  });

  test("carries the driver instance id into details", () => {
    const error = classifyReclaim({
      driverInstanceId: "driver-1",
      driverTerminalStatus: "stopped",
      reclaimReason: "socket_closed",
    });
    expect(error.details).toEqual({ driverInstanceId: "driver-1" });
  });
});

describe("decideReclaimRecovery", () => {
  const TERMINAL: SessionRunStatus[] = ["completed", "failed", "cancelled", "expired"];
  const ACTIVE: SessionRunStatus[] = ["queued", "booting", "running", "waiting_input"];
  const FIRST_ATTEMPT_TRIGGERS: SessionRunTrigger[] = ["user_prompt", "retry", "system"];

  for (const runStatus of TERMINAL) {
    test(`terminal run (${runStatus}) -> noop`, () => {
      const action = decideReclaimRecovery({
        driverTerminalStatus: "stopped",
        priorTrigger: "user_prompt",
        reclaimReason: "socket_closed",
        runStatus,
      });
      expect(action.kind).toBe("noop");
    });
  }

  for (const runStatus of ACTIVE) {
    for (const priorTrigger of FIRST_ATTEMPT_TRIGGERS) {
      test(`active run (${runStatus}), first reclaim (trigger=${priorTrigger}) -> requeue`, () => {
        const action = decideReclaimRecovery({
          driverTerminalStatus: "stopped",
          priorTrigger,
          reclaimReason: "socket_closed",
          runStatus,
        });
        expect(action.kind).toBe("requeue");
        if (action.kind === "requeue") {
          expect(action.resumeTrigger).toBe("resume");
          expect(action.runError.retryable).toBe(true);
        }
      });
    }

    test(`active run (${runStatus}) already resumed once -> fail_clean (no loop)`, () => {
      const action = decideReclaimRecovery({
        driverTerminalStatus: "failed",
        priorTrigger: "resume",
        reclaimReason: "heartbeat_stale",
        runStatus,
      });
      expect(action.kind).toBe("fail_clean");
      if (action.kind === "fail_clean") {
        // fail_clean is still retryable so the user may resend — it only means
        // we stop AUTO-resuming.
        expect(action.runError.retryable).toBe(true);
      }
    });
  }

  test("respects a custom attempt budget", () => {
    const twoAttempts = decideReclaimRecovery({
      driverTerminalStatus: "stopped",
      maxReclaimAttempts: 2,
      priorTrigger: "resume",
      reclaimReason: "socket_closed",
      runStatus: "running",
    });
    // resume run has spent 1 attempt; budget of 2 still allows another requeue.
    expect(twoAttempts.kind).toBe("requeue");
  });
});
