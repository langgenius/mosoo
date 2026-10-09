import { describe, expect, spyOn, test } from "bun:test";

import { createStopwatch, systemClock, toIsoString } from "../src/time";

describe("time helpers", () => {
  test("serializes numeric timestamp strings returned by D1-compatible rows", () => {
    const timestampMs = 1779124653283;

    expect(toIsoString(String(timestampMs))).toBe(new Date(timestampMs).toISOString());
  });

  test("normalizes stopwatch elapsed milliseconds", () => {
    const now = spyOn(systemClock, "nowMs").mockReturnValue(100.4);

    try {
      const stopwatch = createStopwatch();

      now.mockReturnValue(135.6);

      expect(stopwatch.startedAtMs).toBe(100.4);
      expect(stopwatch.elapsedMs()).toBe(35);
      expect(stopwatch.elapsedAt(132.8)).toBe(32);
    } finally {
      now.mockRestore();
    }
  });
});
