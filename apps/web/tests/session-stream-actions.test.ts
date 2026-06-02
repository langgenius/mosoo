import { describe, expect, test } from "bun:test";

import { createInitialSessionLiveState } from "@mosoo/ag-ui-session";
import type { SessionLiveState } from "@mosoo/ag-ui-session";

import { isSessionStreamStreaming } from "../src/domains/runtime/session-stream/session-stream-actions";

function liveState(input: {
  lifecycle: SessionLiveState["lifecycle"];
  runStatus: SessionLiveState["run"]["status"];
}): SessionLiveState {
  const state = createInitialSessionLiveState({
    sessionId: "session-1",
    title: null,
    viewerId: "viewer-1",
  });

  return {
    ...state,
    lifecycle: input.lifecycle,
    run: {
      ...state.run,
      id: input.runStatus === "idle" ? null : "run-1",
      status: input.runStatus,
    },
  };
}

describe("session stream actions", () => {
  test("derives visible streaming from projected lifecycle", () => {
    expect(
      isSessionStreamStreaming(liveState({ lifecycle: "RUNNING", runStatus: "running" })),
    ).toBe(true);
    expect(isSessionStreamStreaming(liveState({ lifecycle: "IDLE", runStatus: "running" }))).toBe(
      false,
    );
    expect(isSessionStreamStreaming(liveState({ lifecycle: "IDLE", runStatus: "completed" }))).toBe(
      false,
    );
  });
});
