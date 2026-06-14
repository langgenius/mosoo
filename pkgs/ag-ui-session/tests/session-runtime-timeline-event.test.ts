import { describe, expect, test } from "bun:test";

import { createSessionRuntimeTimelineEvent, parseAgUiSessionEventJson } from "@mosoo/ag-ui-session";

describe("session runtime timeline AG UI event", () => {
  test("apps runtime timing into a public timeline event", () => {
    const event = createSessionRuntimeTimelineEvent({
      completedAtMs: 150,
      path: "cold",
      phases: [{ durationMs: 50, name: "driver.start" }],
      runId: "run-1",
      sessionId: "session-1",
      source: "api",
      stage: "prepare_run",
      startedAtMs: 100,
      totalMs: 50,
      traceId: "trace-1",
    });

    const parsed = parseAgUiSessionEventJson(JSON.stringify(event));

    expect(parsed).toMatchObject({
      name: "mosoo.session.runtime.timeline.updated",
      type: "CUSTOM",
      value: {
        durationMs: 50,
        runId: "run-1",
        sessionId: "session-1",
        stage: "prepare_run",
        traceId: "trace-1",
      },
    });
  });
});
