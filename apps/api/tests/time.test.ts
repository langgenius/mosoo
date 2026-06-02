import { describe, expect, test } from "bun:test";

import { createStopwatch, toIsoString } from "../src/time";

describe("time helpers", () => {
  test("serializes numeric timestamp strings returned by D1-compatible rows", () => {
    const timestampMs = 1779124653283;

    expect(toIsoString(String(timestampMs))).toBe(new Date(timestampMs).toISOString());
  });

  test("normalizes stopwatch elapsed milliseconds", () => {
    let now = 100.4;
    const stopwatch = createStopwatch({ nowMs: () => now });

    now = 135.6;

    expect(stopwatch.startedAtMs).toBe(100.4);
    expect(stopwatch.elapsedMs()).toBe(35);
    expect(stopwatch.elapsedAt(132.8)).toBe(32);
  });
});
