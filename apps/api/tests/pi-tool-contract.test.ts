import { describe, expect, test } from "bun:test";

import {
  applyAgUiEventsToSessionLiveState,
  createInitialSessionLiveState,
  EventType,
} from "@mosoo/ag-ui-session";
import { createPlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import { projectRuntimeEventToAgUiSessionEvents, toRuntimeEventInput } from "@mosoo/runtime-events";

import type { JsonObject } from "../../driver/src/protocol/json";
import { PiEventTranslator } from "../../driver/src/runtimes/pi/pi-event-translator";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";

function createHarness() {
  const translator = new PiEventTranslator();
  let state = createInitialSessionLiveState({
    sessionId: PLATFORM_ID_FIXTURES.session,
    title: "Pi tool contract",
    viewerId: PLATFORM_ID_FIXTURES.account,
  });

  return {
    get state() {
      return state;
    },
    send(record: JsonObject) {
      const runtimeEvents = translator.translate(record).flatMap((event) =>
        toRuntimeEventInput(
          {
            createId: createPlatformId,
            driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
            occurredAt: "2026-10-07T00:00:00.000Z",
            runId: PLATFORM_ID_FIXTURES.sessionRun,
            runtimeId: "pi-runtime",
            sessionId: PLATFORM_ID_FIXTURES.session,
          },
          event,
        ),
      );
      const deliveryEvents = runtimeEvents.flatMap(projectRuntimeEventToAgUiSessionEvents);
      state = applyAgUiEventsToSessionLiveState(state, deliveryEvents);
      return { deliveryEvents, runtimeEvents };
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function announceTools(harness: Harness, tools: JsonObject[]): string {
  const started = harness.send({ type: "message_start", message: { role: "assistant" } });
  const event = started.deliveryEvents.find((entry) => entry.type === EventType.TEXT_MESSAGE_START);
  if (event?.type !== EventType.TEXT_MESSAGE_START)
    throw new Error("Assistant message did not start");

  // Pi finishes the assistant message before executing its tool calls. The
  // translator must retain each toolCall.id's parent after clearing messageId.
  harness.send({
    type: "message_end",
    message: { role: "assistant", content: tools, stopReason: "toolUse" },
  });
  return event.messageId;
}

describe("Pi tools across the Host event and transcript boundary", () => {
  test("keeps bash and read calls on their assistant message with complete inputs and outputs", () => {
    const harness = createHarness();
    const bashArgs = { command: "printf 'workspace-ok\\n'", timeout: 30 };
    const readArgs = { path: "/workspace/result.txt", offset: 2, limit: 1 };
    const parentMessageId = announceTools(harness, [
      { type: "toolCall", id: "bash-1", name: "bash", arguments: bashArgs },
      { type: "toolCall", id: "read-1", name: "read", arguments: readArgs },
    ]);

    const started = harness.send({
      type: "tool_execution_start",
      toolCallId: "bash-1",
      toolName: "bash",
      args: bashArgs,
    });
    expect(started.deliveryEvents).toContainEqual({
      type: EventType.TOOL_CALL_START,
      parentMessageId,
      toolCallId: "bash-1",
      toolCallName: "bash",
    });
    expect(harness.state.messages[0]?.segments).toContainEqual({
      argsText: "",
      kind: "tool_use",
      path: null,
      tool: "bash",
      toolCallId: "bash-1",
    });

    const updated = harness.send({
      type: "tool_execution_update",
      toolCallId: "bash-1",
      toolName: "bash",
      args: bashArgs,
      partialResult: { content: [{ type: "text", text: "workspace-" }] },
    });
    expect(updated.runtimeEvents[0]?.payload).toMatchObject({
      parentMessageId,
      rawOutput: "workspace-",
      status: "running",
    });
    expect(
      harness.state.messages[0]?.segments.filter((entry) => entry.kind === "tool_result"),
    ).toEqual([]);

    const bashEnded = harness.send({
      type: "tool_execution_end",
      toolCallId: "bash-1",
      toolName: "bash",
      isError: false,
      result: { content: [{ type: "text", text: "workspace-ok\n" }] },
    });
    expect(bashEnded.runtimeEvents[0]?.payload).toMatchObject({
      parentMessageId,
      rawInput: JSON.stringify(bashArgs),
      rawOutput: "workspace-ok\n",
      status: "completed",
    });
    expect(bashEnded.runtimeEvents.map(createSessionRuntimeEventProjection)).toMatchObject([
      {
        contentText: "bash result: workspace-ok",
        toolInputJson: JSON.stringify(bashArgs),
        processType: "tool.use.completed",
      },
    ]);

    harness.send({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: readArgs,
    });
    const readEnded = harness.send({
      type: "tool_execution_end",
      toolCallId: "read-1",
      toolName: "read",
      isError: false,
      result: { content: [{ type: "text", text: "second line\n" }] },
    });
    expect(readEnded.runtimeEvents.map(createSessionRuntimeEventProjection)).toMatchObject([
      {
        toolCallId: "read-1",
        toolInputJson: '{"limit":1,"offset":2,"path":"/workspace/result.txt"}',
        contentText: "read result: second line",
      },
    ]);
    expect(harness.state.messages).toHaveLength(1);
    expect(harness.state.messages[0]).toMatchObject({
      id: parentMessageId,
      segments: [
        {
          kind: "tool_use",
          tool: "bash",
          toolCallId: "bash-1",
          argsText: JSON.stringify(bashArgs),
        },
        { kind: "tool_result", tool: "bash", toolCallId: "bash-1", output: "workspace-ok\n" },
        {
          kind: "tool_use",
          tool: "read",
          toolCallId: "read-1",
          argsText: JSON.stringify(readArgs),
        },
        { kind: "tool_result", tool: "read", toolCallId: "read-1", output: "second line\n" },
      ],
    });
  });

  test("keeps a failed call on the second assistant message and preserves the actual error", () => {
    const harness = createHarness();
    const firstMessageId = announceTools(harness, [
      { type: "toolCall", id: "read-ok", name: "read", arguments: { path: "/workspace/ok.txt" } },
    ]);
    harness.send({
      type: "tool_execution_start",
      toolCallId: "read-ok",
      toolName: "read",
      args: { path: "/workspace/ok.txt" },
    });
    harness.send({
      type: "tool_execution_end",
      toolCallId: "read-ok",
      toolName: "read",
      isError: false,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    const failedArgs = { path: "/workspace/missing.txt" };
    const secondMessageId = announceTools(harness, [
      { type: "toolCall", id: "read-failed", name: "read", arguments: failedArgs },
    ]);
    harness.send({
      type: "tool_execution_start",
      toolCallId: "read-failed",
      toolName: "read",
      args: failedArgs,
    });
    const error = "ENOENT: /workspace/missing.txt";
    const failed = harness.send({
      type: "tool_execution_end",
      toolCallId: "read-failed",
      toolName: "read",
      isError: true,
      result: { content: [{ type: "text", text: error }] },
    });
    expect(failed.runtimeEvents.map(createSessionRuntimeEventProjection)).toMatchObject([
      {
        processStatus: "error",
        toolInputJson: JSON.stringify(failedArgs),
        contentText: `read result: ${error}`,
      },
    ]);
    expect(
      harness.state.messages.map((message) => ({ id: message.id, segments: message.segments })),
    ).toMatchObject([
      {
        id: firstMessageId,
        segments: [
          { kind: "tool_use", toolCallId: "read-ok", argsText: '{"path":"/workspace/ok.txt"}' },
          { kind: "tool_result", toolCallId: "read-ok", output: "ok" },
        ],
      },
      {
        id: secondMessageId,
        segments: [
          { kind: "tool_use", toolCallId: "read-failed", argsText: JSON.stringify(failedArgs) },
          { kind: "tool_result", toolCallId: "read-failed", output: error },
        ],
      },
    ]);
  });
});
