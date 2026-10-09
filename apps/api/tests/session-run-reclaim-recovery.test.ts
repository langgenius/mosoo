import { describe, expect, test } from "bun:test";

import { classifyReclaim } from "../src/modules/runtime/domain/session-run-reclaim-recovery";
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
