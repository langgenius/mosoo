import { describe, expect, test } from "bun:test";

import { createInitialSessionLiveState, parseAgUiSessionEventJson } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent, SessionLiveState } from "@mosoo/ag-ui-session";

function validStateSnapshot(): SessionLiveState {
  const state = createInitialSessionLiveState({
    sessionId: "session-1",
    title: null,
    viewerId: "viewer-1",
  });

  return {
    ...state,
    lifecycle: "RUNNING",
    run: {
      ...state.run,
      id: "run-1",
      startedAt: "2026-05-09T00:00:00.000Z",
      status: "running",
    },
  };
}

describe("AG-UI session codec boundary", () => {
  test("accepts official AG-UI chunk events at the session boundary", () => {
    expect(
      parseAgUiSessionEventJson(
        JSON.stringify({
          delta: "hello",
          messageId: "message-1",
          role: "assistant",
          type: "TEXT_MESSAGE_CHUNK",
        }),
      ),
    ).toEqual({
      delta: "hello",
      messageId: "message-1",
      role: "assistant",
      type: "TEXT_MESSAGE_CHUNK",
    });
  });

  test("rejects nested invalid state snapshots instead of trusting the top-level event type", () => {
    const event = {
      snapshot: {
        ...validStateSnapshot(),
        run: {
          ...validStateSnapshot().run,
          status: "launching",
        },
      },
      type: "STATE_SNAPSHOT",
    };

    expect(() => parseAgUiSessionEventJson(JSON.stringify(event))).toThrow();
  });

  test("parses standard AG-UI text content events", () => {
    expect(
      parseAgUiSessionEventJson(
        JSON.stringify({
          delta: "hello",
          messageId: "message-1",
          type: "TEXT_MESSAGE_CONTENT",
        }),
      ),
    ).toEqual({
      delta: "hello",
      messageId: "message-1",
      type: "TEXT_MESSAGE_CONTENT",
    });
  });

  test("rejects malformed custom session payloads before they reach live-state reducers", () => {
    const event = {
      name: "mosoo.session.permissions.updated",
      type: "CUSTOM",
      value: {
        permissionRequests: [
          {
            title: "Run command",
            toolCallId: "tool-1",
          },
        ],
      },
    };

    expect(() => parseAgUiSessionEventJson(JSON.stringify(event))).toThrow();
  });

  test("rejects nullable numeric fields when the custom contract requires numbers", () => {
    const event = {
      name: "mosoo.session.runtime.timing",
      type: "CUSTOM",
      value: {
        completedAtMs: 2,
        path: "warm",
        phases: [{ durationMs: null, name: "prepare" }],
        runId: "run-1",
        sessionId: "session-1",
        source: "api",
        stage: "prepare_run",
        startedAtMs: 1,
        totalMs: null,
        traceId: null,
      },
    };

    expect(() => parseAgUiSessionEventJson(JSON.stringify(event))).toThrow();
  });

  test("preserves AG-UI base fields on custom events", () => {
    expect(
      parseAgUiSessionEventJson(
        JSON.stringify({
          name: "mosoo.session.info.updated",
          rawEvent: {
            source: "driver",
          },
          timestamp: 1,
          type: "CUSTOM",
          value: {
            title: "Preview",
          },
        }),
      ),
    ).toEqual({
      name: "mosoo.session.info.updated",
      rawEvent: {
        source: "driver",
      },
      timestamp: 1,
      type: "CUSTOM",
      value: {
        title: "Preview",
      },
    });
  });

  test("rejects partial message segments in state snapshots", () => {
    const event = {
      snapshot: {
        ...validStateSnapshot(),
        messages: [
          {
            content: "",
            createdAt: "2026-05-09T00:00:00.000Z",
            id: "message-1",
            plan: [],
            role: "assistant",
            segments: [
              {
                kind: "tool_use",
                tool: "shell",
              },
            ],
          },
        ],
      },
      type: "STATE_SNAPSHOT",
    };

    expect(() => parseAgUiSessionEventJson(JSON.stringify(event))).toThrow();
  });

  test("accepts one fully shaped AG-UI event per JSON payload", () => {
    const event: AgUiSessionEvent = {
      snapshot: validStateSnapshot(),
      type: "STATE_SNAPSHOT",
    };

    const parsed = parseAgUiSessionEventJson(JSON.stringify(event));

    expect(parsed.type).toBe("STATE_SNAPSHOT");

    if (parsed.type !== "STATE_SNAPSHOT") {
      throw new Error("Expected a state snapshot event.");
    }

    expect(parsed.snapshot.sessionId).toBe("session-1");
    expect(parsed.snapshot.run).toMatchObject({
      id: "run-1",
      startedAt: "2026-05-09T00:00:00.000Z",
      status: "running",
    });
  });
});
