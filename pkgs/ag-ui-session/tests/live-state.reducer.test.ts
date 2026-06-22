import { describe, expect, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  createSessionLiveStateMessage,
  isSessionLiveStateStreaming,
  MOSOO_CUSTOM_EVENT,
  parseAgUiSessionEvent,
  parseAgUiSessionEventJson,
  serializeAgUiSessionEvent,
} from "@mosoo/ag-ui-session";
import type { AgUiEvent, SessionLiveState } from "@mosoo/ag-ui-session";

function baseState(): SessionLiveState {
  return createInitialSessionLiveState({
    sessionId: "session-1",
    title: "Runtime Preview",
    viewerId: "viewer-1",
  });
}

function runView(
  input: Partial<SessionLiveState["run"]> & Pick<SessionLiveState["run"], "id" | "status">,
): SessionLiveState["run"] {
  return {
    ...baseState().run,
    ...input,
  };
}

describe("session live-state transcript reducer", () => {
  test("replaces live state when a state snapshot arrives", () => {
    const userMessage = createSessionLiveStateMessage({
      content: "hello",
      createdAt: "2026-04-30T00:00:00.000Z",
      id: "user-1",
      role: "user",
    });
    const initialState: SessionLiveState = {
      ...baseState(),
      messages: [userMessage],
    };
    const snapshot: SessionLiveState = {
      ...baseState(),
      messages: [
        createSessionLiveStateMessage({
          content: "Hi",
          createdAt: "2026-04-30T00:00:01.000Z",
          id: "assistant-1",
          role: "assistant",
        }),
      ],
      run: {
        ...baseState().run,
        id: "run-1",
        status: "running",
      },
    };

    const nextState = applyAgUiEventsToSessionLiveState(initialState, [
      { snapshot, type: "STATE_SNAPSHOT" },
    ]);

    expect(nextState.messages.map((message) => message.id)).toEqual(["assistant-1"]);
    expect(nextState.run.status).toBe("running");
  });

  test("replaces messages when a messages snapshot arrives", () => {
    const existingMessage = createSessionLiveStateMessage({
      content: "hello",
      createdAt: "2026-04-30T00:00:00.000Z",
      id: "user-1",
      role: "user",
    });
    const initialState: SessionLiveState = {
      ...baseState(),
      messages: [existingMessage],
    };

    const nextState = applyAgUiEventsToSessionLiveState(initialState, [
      {
        messages: [
          {
            content: "Hi",
            id: "assistant-1",
            role: "assistant",
          },
        ],
        type: "MESSAGES_SNAPSHOT",
      },
    ]);

    expect(nextState.messages.map((message) => [message.id, message.content])).toEqual([
      ["assistant-1", "Hi"],
    ]);
  });

  test("applies text deltas in transcript order to one assistant message", () => {
    const nextState = applyAgUiEventsToSessionLiveState(baseState(), [
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: ". What do you need help", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      { delta: " with?", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      { messageId: "assistant-1", type: "TEXT_MESSAGE_END" },
    ]);

    expect(nextState.messages).toHaveLength(1);
    expect(nextState.messages[0]?.content).toBe(". What do you need help with?");
    expect(nextState.messages[0]?.segments).toEqual([
      { kind: "text", text: ". What do you need help with?" },
    ]);
  });

  test("does not merge streamed text across intervening transcript events", () => {
    const nextState = applyAgUiEventsToSessionLiveState(baseState(), [
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "before", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
      { delta: "after", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);

    expect(nextState.messages[0]?.segments).toEqual([
      { kind: "text", text: "before" },
      { argsText: "", kind: "tool_use", path: null, tool: "Shell", toolCallId: "tool-1" },
      { kind: "text", text: "after" },
    ]);
  });

  test("normalizes tool result before tool start into one ordered tool call", () => {
    const nextState = applyAgUiEventsToSessionLiveState(baseState(), [
      {
        content: "workspace files",
        messageId: "assistant-1",
        toolCallId: "tool-1",
        type: "TOOL_CALL_RESULT",
      },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
    ]);

    expect(nextState.messages).toHaveLength(1);
    expect(nextState.messages[0]?.segments).toEqual([
      { argsText: "", kind: "tool_use", path: null, tool: "Shell", toolCallId: "tool-1" },
      {
        kind: "tool_result",
        output: "workspace files",
        tool: "Shell",
        toolCallId: "tool-1",
      },
    ]);
  });

  test("merges streamed tool arguments into the existing tool call segment", () => {
    const nextState = applyAgUiEventsToSessionLiveState(baseState(), [
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
      { delta: '{"cmd"', toolCallId: "tool-1", type: "TOOL_CALL_ARGS" },
      { delta: ':"ls"}', toolCallId: "tool-1", type: "TOOL_CALL_ARGS" },
    ]);

    expect(nextState.messages[0]?.segments).toEqual([
      {
        argsText: '{"cmd":"ls"}',
        kind: "tool_use",
        path: null,
        tool: "Shell",
        toolCallId: "tool-1",
      },
    ]);
  });

  test("terminal run states do not synthesize missing tool results", () => {
    const nextState = applyAgUiEventsToSessionLiveState(baseState(), [
      { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
      { runId: "run-1", threadId: "session-1", type: "RUN_FINISHED" },
    ]);

    expect(nextState.run.status).toBe("completed");
    expect(nextState.lifecycle).toBe("IDLE");
    expect(nextState.permissionRequests).toEqual([]);
    expect(nextState.messages[0]?.segments).toEqual([
      { argsText: "", kind: "tool_use", path: null, tool: "Shell", toolCallId: "tool-1" },
    ]);
  });

  test("run errors fail the run without terminating the session", () => {
    const stateWithPermission: SessionLiveState = {
      ...baseState(),
      permissionRequests: [
        {
          driverInstanceId: "driver-1",
          rawInput: "ls",
          requestId: "permission-1",
          runId: "run-1",
          title: "Run shell",
          toolCallId: "tool-1",
          toolKind: "command",
        },
      ],
    };
    const nextState = applyAgUiEventsToSessionLiveState(stateWithPermission, [
      { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
      {
        code: "runtime.provision_failed",
        message: "Runtime failed to start.",
        type: "RUN_ERROR",
      },
    ]);

    expect(nextState.lifecycle).toBe("IDLE");
    expect(nextState.permissionRequests).toEqual([]);
    expect(nextState.run.status).toBe("failed");
    expect(nextState.run.error?.code).toBe("runtime.provision_failed");
    expect(nextState.messages[0]?.segments.at(-1)).toEqual({
      argsText: "",
      kind: "tool_use",
      path: null,
      tool: "Shell",
      toolCallId: "tool-1",
    });
  });

  test("ignores stale standard terminal events for inactive runs", () => {
    const runningState = applyAgUiEventsToSessionLiveState(baseState(), [
      { runId: "run-2", threadId: "session-1", type: "RUN_STARTED" },
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
    ]);

    const nextState = applyAgUiEventsToSessionLiveState(runningState, [
      { runId: "run-1", threadId: "session-1", type: "RUN_FINISHED" },
    ]);

    expect(nextState.lifecycle).toBe("RUNNING");
    expect(nextState.run).toMatchObject({
      id: "run-2",
      status: "running",
    });
    expect(nextState.messages[0]?.segments).toEqual([
      { argsText: "", kind: "tool_use", path: null, tool: "Shell", toolCallId: "tool-1" },
    ]);
  });

  test("ignores standard run errors after the active run is terminal", () => {
    const completedState = applyAgUiEventsToSessionLiveState(baseState(), [
      { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
      { runId: "run-1", threadId: "session-1", type: "RUN_FINISHED" },
    ]);

    const nextState = applyAgUiEventsToSessionLiveState(completedState, [
      {
        code: "runtime.late_error",
        message: "late failure",
        type: "RUN_ERROR",
      },
    ]);

    expect(nextState.run.status).toBe("completed");
    expect(nextState.run.error).toBeNull();
    expect(nextState.lifecycle).toBe("IDLE");
  });

  test("rejects unknown custom events before live state can mark a run successful", () => {
    const state = baseState();

    expect(() =>
      parseAgUiSessionEvent({
        name: "mosoo.session.run.completed",
        type: "CUSTOM",
        value: {
          lifecycle: "IDLE",
          run: runView({
            completedAt: "2026-04-30T00:00:03.000Z",
            id: "run-1",
            startedAt: "2026-04-30T00:00:00.000Z",
            status: "completed",
          }),
        },
      }),
    ).toThrow();
    expect(isSessionLiveStateStreaming(state)).toBe(false);
    expect(state.run.status).toBe("idle");
  });

  test("ignores stale custom run updates after another run is active", () => {
    const runningState: SessionLiveState = {
      ...baseState(),
      lifecycle: "RUNNING",
      run: runView({
        id: "run-2",
        startedAt: "2026-04-30T00:00:02.000Z",
        status: "running",
      }),
    };

    const nextState = applyAgUiEventsToSessionLiveState(runningState, [
      {
        name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
        type: "CUSTOM",
        value: {
          lifecycle: "IDLE",
          run: runView({
            completedAt: "2026-04-30T00:00:03.000Z",
            id: "run-1",
            startedAt: "2026-04-30T00:00:00.000Z",
            status: "completed",
          }),
        },
      },
    ]);

    expect(nextState.run).toMatchObject({
      id: "run-2",
      status: "running",
    });
    expect(nextState.lifecycle).toBe("RUNNING");
  });

  test("custom run terminal updates preserve current timing and failure infra", () => {
    const runningState: SessionLiveState = {
      ...baseState(),
      lifecycle: "RUNNING",
      permissionRequests: [
        {
          driverInstanceId: "driver-1",
          rawInput: "pwd",
          requestId: "permission-1",
          runId: "run-1",
          title: "Approve command",
          toolCallId: "tool-1",
          toolKind: "bash",
        },
      ],
      run: runView({
        id: "run-1",
        startedAt: "2026-04-30T00:00:00.000Z",
        status: "running",
        traceId: "trace-1",
      }),
    };

    const nextState = applyAgUiEventsToSessionLiveState(runningState, [
      {
        name: MOSOO_CUSTOM_EVENT.sessionRunUpdated.name,
        type: "CUSTOM",
        value: {
          lifecycle: "IDLE",
          run: runView({
            completedAt: "2026-04-30T00:00:03.000Z",
            error: {
              code: "runtime.failed",
              details: {},
              message: "Runtime failed.",
              retryable: false,
            },
            id: "run-1",
            status: "failed",
          }),
        },
      },
    ]);

    expect(nextState.permissionRequests).toEqual([]);
    expect(nextState.run).toMatchObject({
      completedAt: "2026-04-30T00:00:03.000Z",
      id: "run-1",
      startedAt: "2026-04-30T00:00:00.000Z",
      status: "failed",
      traceId: "trace-1",
    });
    expect(nextState.infra).toMatchObject({
      lastFailureMessage: "Runtime failed.",
      lastFailureReason: "runtime.failed",
      reconnecting: false,
    });
  });

  test("permission updates populate pending approvals and mark the run waiting", () => {
    const runningState: SessionLiveState = {
      ...baseState(),
      run: {
        ...baseState().run,
        id: "run-1",
        status: "running",
      },
    };

    const nextState = applyAgUiEventsToSessionLiveState(runningState, [
      {
        name: "mosoo.session.permissions.updated",
        type: "CUSTOM",
        value: {
          permissionRequests: [
            {
              driverInstanceId: "driver-1",
              rawInput: "pwd",
              requestId: "permission-1",
              runId: "run-1",
              title: "Approve command",
              toolCallId: "tool-1",
              toolKind: "bash",
            },
          ],
        },
      },
    ]);

    expect(nextState.run.status).toBe("waiting_input");
    expect(nextState.permissionRequests).toEqual([
      {
        driverInstanceId: "driver-1",
        rawInput: "pwd",
        requestId: "permission-1",
        runId: "run-1",
        title: "Approve command",
        toolCallId: "tool-1",
        toolKind: "bash",
      },
    ]);
  });

  test("ignores permission updates from stale runs", () => {
    const runningState: SessionLiveState = {
      ...baseState(),
      lifecycle: "RUNNING",
      run: {
        ...baseState().run,
        id: "run-2",
        status: "running",
      },
    };

    const nextState = applyAgUiEventsToSessionLiveState(runningState, [
      {
        name: "mosoo.session.permissions.updated",
        type: "CUSTOM",
        value: {
          permissionRequests: [
            {
              driverInstanceId: "driver-1",
              rawInput: "pwd",
              requestId: "permission-1",
              runId: "run-1",
              title: "Approve command",
              toolCallId: "tool-1",
              toolKind: "bash",
            },
          ],
        },
      },
    ]);

    expect(nextState.run).toMatchObject({
      id: "run-2",
      status: "running",
    });
    expect(nextState.lifecycle).toBe("RUNNING");
    expect(nextState.permissionRequests).toEqual([]);
  });

  test("permission resolution clears pending approvals and returns the run to running", () => {
    const waitingState: SessionLiveState = {
      ...baseState(),
      permissionRequests: [
        {
          driverInstanceId: "driver-1",
          rawInput: "pwd",
          requestId: "permission-1",
          runId: "run-1",
          title: "Approve command",
          toolCallId: "tool-1",
          toolKind: "bash",
        },
      ],
      run: {
        ...baseState().run,
        id: "run-1",
        status: "waiting_input",
      },
    };

    const nextState = applyAgUiEventsToSessionLiveState(waitingState, [
      {
        name: "mosoo.session.permissions.updated",
        type: "CUSTOM",
        value: {
          permissionRequests: [],
        },
      },
    ]);

    expect(nextState.run.status).toBe("running");
    expect(nextState.permissionRequests).toEqual([]);
  });

  test("stopped custom event terminates the session and clears pending approvals", () => {
    const stateWithPermission: SessionLiveState = {
      ...baseState(),
      permissionRequests: [
        {
          driverInstanceId: "driver-1",
          rawInput: "ls",
          requestId: "permission-1",
          runId: "run-1",
          title: "Run shell",
          toolCallId: "tool-1",
          toolKind: "command",
        },
      ],
    };
    const events: AgUiEvent[] = [
      { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      {
        parentMessageId: "assistant-1",
        toolCallId: "tool-1",
        toolCallName: "Shell",
        type: "TOOL_CALL_START",
      },
      {
        name: "mosoo.session.stopped",
        type: "CUSTOM",
        value: {
          message: "Driver control socket closed.",
          reason: "runtime.driver_stopped",
        },
      },
    ];

    const nextState = applyAgUiEventsToSessionLiveState(stateWithPermission, events);

    expect(nextState.lifecycle).toBe("TERMINATED");
    expect(nextState.permissionRequests).toEqual([]);
    expect(nextState.run.status).toBe("failed");
    expect(nextState.run.error?.code).toBe("runtime.driver_stopped");
    expect(nextState.messages[0]?.segments.at(-1)).toEqual({
      argsText: "",
      kind: "tool_use",
      path: null,
      tool: "Shell",
      toolCallId: "tool-1",
    });
  });

  test("agent ready clears updating overlay without marking the cancelled run as running", () => {
    const updatingState = applyAgUiEventsToSessionLiveState(baseState(), [
      { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
      {
        name: "mosoo.agent.updating",
        type: "CUSTOM",
        value: {
          agentId: "agent-1",
          operation: "restartDriver",
          startedAt: "2026-05-04T10:00:00.000Z",
        },
      },
      {
        snapshot: {
          ...baseState(),
          lifecycle: "IDLE",
          run: {
            ...baseState().run,
            completedAt: "2026-05-04T10:00:01.000Z",
            id: "run-1",
            status: "cancelled",
          },
        },
        type: "STATE_SNAPSHOT",
      },
      {
        name: "mosoo.agent.ready",
        type: "CUSTOM",
        value: {
          agentId: "agent-1",
          operation: "restartDriver",
          readyAt: "2026-05-04T10:00:02.000Z",
        },
      },
    ]);

    expect(updatingState.lifecycle).toBe("IDLE");
    expect(updatingState.infra.reconnecting).toBe(false);
    expect(updatingState.run.status).toBe("cancelled");
  });
});

describe("AG-UI session JSON payloads", () => {
  test("round-trips an AG-UI event JSON payload", () => {
    const event: AgUiEvent = {
      delta: "hello",
      messageId: "assistant-1",
      type: "TEXT_MESSAGE_CONTENT",
    };

    expect(parseAgUiSessionEventJson(serializeAgUiSessionEvent(event))).toEqual(event);
  });
});
