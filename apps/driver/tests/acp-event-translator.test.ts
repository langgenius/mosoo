import { describe, expect, test } from "bun:test";

import type { DriverEventInput } from "@mosoo/driver-protocol";

import {
  AcpTurnEventState,
  toAcpPermissionRequest,
  toAcpPermissionResolvedEvent,
  toAcpSessionReadyEvents,
} from "../src/runtimes/acp/acp-event-translator";

function eventKinds(events: readonly DriverEventInput[]): string[] {
  return events.map((event) => event.kind);
}

function eventPayload(event: DriverEventInput): Record<string, unknown> {
  expect(event.payload).toBeObject();
  return event.payload as Record<string, unknown>;
}

describe("ACP runtime event translation", () => {
  test("maps ACP turn updates onto canonical runtime events with one tool lifecycle", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    const events = [
      ...state.translateUpdate({
        update: {
          content: {
            text: "hello",
            type: "text",
          },
          sessionUpdate: "agent_message_chunk",
        },
      }),
      ...state.translateUpdate({
        update: {
          kind: "shell",
          rawInput: { command: "pwd" },
          sessionUpdate: "tool_call",
          status: "running",
          title: "Run command",
          toolCallId: "tool-1",
        },
      }),
      ...state.translateUpdate({
        update: {
          rawOutput: { text: "/workspace" },
          sessionUpdate: "tool_call_update",
          status: "completed",
          toolCallId: "tool-1",
        },
      }),
      ...state.translateUpdate({
        update: {
          rawOutput: { text: "/workspace" },
          sessionUpdate: "tool_call_update",
          status: "completed",
          toolCallId: "tool-1",
        },
      }),
      ...state.completePrompt("end_turn", { totalTokens: 12 }),
    ];

    const kinds = eventKinds(events);

    expect(kinds).toEqual([
      "message.started",
      "message.delta",
      "item.started",
      "tool.call.updated",
      "tool.call.updated",
      "item.completed",
      "tool.call.updated",
      "message.completed",
      "usage.updated",
      "run.completed",
    ]);
    expect(kinds.filter((kind) => kind === "item.started")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "item.completed")).toHaveLength(1);
    expect(kinds.every((kind) => kind.includes("."))).toBe(true);
  });

  test("preserves the ACP request id across permission request and resolution events", () => {
    const translation = toAcpPermissionRequest({
      params: {
        options: [
          { kind: "allow_once", name: "Allow once", optionId: "allow" },
          { kind: "reject_once", name: "Reject once", optionId: "reject" },
        ],
        toolCall: {
          kind: "shell",
          rawInput: { command: "pwd" },
          title: "Run command",
          toolCallId: "tool-1",
        },
      },
      requestId: "rpc-42",
      runId: "run-1",
    });

    const permissionEvent = translation.events.find(
      (event) => event.kind === "permission.requested",
    );

    expect(permissionEvent).toBeDefined();
    expect(translation.requestId).toBe("rpc-42");
    expect(translation.defaultOptionId).toBe("allow");
    expect(eventPayload(permissionEvent as DriverEventInput)).toMatchObject({
      defaultOptionId: "allow",
      requestId: "rpc-42",
      targetItemId: "tool-1",
      title: "Run command",
    });

    const resolved = toAcpPermissionResolvedEvent({
      option: translation.options[0] ?? null,
      requestId: translation.requestId,
      runId: "run-1",
    });

    expect(resolved.kind).toBe("permission.resolved");
    expect(eventPayload(resolved)).toMatchObject({
      optionId: "allow",
      optionKind: "allow_once",
      outcome: "selected",
      requestId: "rpc-42",
    });
  });

  test("starts permission tool calls through the turn event state", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    const translation = state.translatePermissionRequest({
      params: {
        options: [{ kind: "allow_once", name: "Allow once", optionId: "allow" }],
        toolCall: {
          kind: "shell",
          rawInput: { command: "pwd" },
          title: "Run command",
          toolCallId: "tool-1",
        },
      },
      requestId: "rpc-42",
    });

    const events = [...translation.events, ...state.completePrompt("end_turn", null)];

    expect(eventKinds(events)).toEqual([
      "item.started",
      "tool.call.updated",
      "permission.requested",
      "item.completed",
      "run.completed",
    ]);
  });

  test("closes unfinished tool calls when a turn completes", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    const events = [
      ...state.translateUpdate({
        update: {
          sessionUpdate: "tool_call",
          status: "running",
          title: "Run command",
          toolCallId: "tool-1",
        },
      }),
      ...state.completePrompt("end_turn", null),
    ];

    expect(eventKinds(events)).toEqual([
      "item.started",
      "tool.call.updated",
      "item.completed",
      "run.completed",
    ]);
    expect(eventPayload(events[2])).toMatchObject({
      itemId: "tool-1",
      status: "completed",
    });
  });

  test("maps max turn request stops to failed runs", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    const events = [
      ...state.translateUpdate({
        update: {
          sessionUpdate: "tool_call",
          status: "running",
          title: "Run command",
          toolCallId: "tool-1",
        },
      }),
      ...state.completePrompt("max_turn_requests", null),
    ];

    expect(eventKinds(events)).toEqual([
      "item.started",
      "tool.call.updated",
      "item.completed",
      "run.failed",
    ]);
    expect(eventPayload(events[2])).toMatchObject({
      error: expect.any(String),
      itemId: "tool-1",
      status: "failed",
    });
    expect(eventPayload(events[3])).toMatchObject({
      error: {
        code: "acp.max_turn_requests",
        message: expect.any(String),
      },
      recoverable: false,
      stopReason: "max_turn_requests",
    });
  });

  test("ignores ACP user message echo chunks because driver input is the source of truth", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    expect(
      state.translateUpdate({
        update: {
          content: {
            text: "hello",
            type: "text",
          },
          sessionUpdate: "user_message_chunk",
        },
      }),
    ).toEqual([]);
  });

  test("closes open stream items before a failed turn event", () => {
    const state = new AcpTurnEventState();

    state.begin({
      messageId: "message-1",
      runId: "run-1",
      sessionId: "session-1",
    });

    const events = [
      ...state.translateUpdate({
        update: {
          content: {
            text: "partial",
            type: "text",
          },
          sessionUpdate: "agent_message_chunk",
        },
      }),
      ...state.translateUpdate({
        update: {
          sessionUpdate: "tool_call",
          status: "running",
          title: "Run command",
          toolCallId: "tool-1",
        },
      }),
      ...state.failPrompt({
        code: "acp.turn_failed",
        message: "transport closed",
      }),
    ];

    expect(eventKinds(events)).toEqual([
      "message.started",
      "message.delta",
      "item.started",
      "tool.call.updated",
      "message.completed",
      "item.completed",
      "run.failed",
    ]);
  });

  test("emits native resume state from ACP session setup", () => {
    const events = toAcpSessionReadyEvents({
      mode: "created",
      nativeSessionId: "native-session-1",
      setup: {
        currentModeId: "default",
      },
    });

    expect(eventKinds(events)).toEqual([
      "session.created",
      "runtime.resume.updated",
      "session.mode.updated",
    ]);
    expect("resumePointer" in eventPayload(events[0])).toBe(false);
    expect(events[1]).toMatchObject({
      visibility: "owner_debug",
    });
  });
});
