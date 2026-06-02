import { describe, expect, test } from "bun:test";

import { shouldWaitForRuntimeReadyOnNewSession } from "../src/routes/agent/components/agent-session-panel-rules";

describe("agent session panel boundary", () => {
  test("only Preview New Session opts into runtime readiness wait", () => {
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "preview",
        waitForRuntimeReadyOnNewSession: true,
      }),
    ).toBe(true);
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "ui",
        waitForRuntimeReadyOnNewSession: true,
      }),
    ).toBe(false);
    expect(
      shouldWaitForRuntimeReadyOnNewSession({
        sessionType: "preview",
        waitForRuntimeReadyOnNewSession: false,
      }),
    ).toBe(false);
  });
});
