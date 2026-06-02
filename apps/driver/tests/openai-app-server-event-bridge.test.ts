import { describe, expect, test } from "bun:test";

import type { DriverEvent } from "@mosoo/driver-protocol";
import { isPlatformId } from "@mosoo/id";
import { createBufferedSinkLogger } from "@mosoo/observability";

import { DriverInstanceSocket } from "../src/infrastructure/runtime/driver-instance-socket";
import type { AgentDriverContext } from "../src/runtimes/agent-driver-backend";
import { OpenAiAppServerEventBridge } from "../src/runtimes/openai/app-server-event-bridge";
import { DRIVER_TEST_IDS } from "./driver-boot-payload-fixture";
import { driverBootPayload as bootPayload } from "./driver-boot-payload-fixture";

interface EventBatch {
  events: DriverEvent[];
  reason: string;
}

function readEventPayloadString(event: DriverEvent, field: string): string | null {
  const payload = event.payload;

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function readAssistantMessageId(events: readonly DriverEvent[]): string {
  for (const event of events) {
    const messageId =
      readEventPayloadString(event, "messageId") ??
      readEventPayloadString(event, "parentMessageId");

    if (messageId !== null) {
      expect(isPlatformId(messageId)).toBe(true);
      return messageId;
    }
  }

  throw new Error("Expected a platform assistant message ID.");
}

function createHarness() {
  const batches: EventBatch[] = [];
  const logger = createBufferedSinkLogger({
    level: "debug",
    service: "openai-app-server-event-bridge-test",
    sink: async () => {},
  });
  const context: AgentDriverContext = {
    logger,
    payload: bootPayload,
    permissions: {
      request: async () => "allow_once",
    },
    socket: new DriverInstanceSocket(bootPayload, { onClose: () => {} }),
  };
  const bridge = new OpenAiAppServerEventBridge({
    push: async (_context, reason, events) => {
      batches.push({ events, reason });
    },
    requireThreadId: () => "thread-1",
  });

  return {
    batches,
    bridge,
    context,
    events: () => batches.flatMap((batch) => batch.events),
    logger,
  };
}

describe("OpenAi app-server event bridge", () => {
  test("turn completion can arrive before the turn response is tracked", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
      },
    });

    await expect(bridge.trackTurn("turn-1", DRIVER_TEST_IDS.runId)).resolves.toBeUndefined();
    await logger.destroy();

    for (const event of events()) {
      expect(event.runId).toBeUndefined();
    }
    expect(events()).toMatchObject([
      {
        kind: "run.started",
        payload: {
          startedAt: expect.any(String),
        },
      },
      {
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    ]);
  });

  test("turn errors can arrive before the turn response is tracked", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "error", {
      error: {
        additionalDetails: "HTTP 502 from upstream.",
        message: "Response stream disconnected.",
      },
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false,
    });

    await expect(bridge.trackTurn("turn-1", DRIVER_TEST_IDS.runId)).rejects.toThrow();
    await logger.destroy();

    const [failedEvent] = events();
    expect(failedEvent?.runId).toBeUndefined();
    expect(events()).toMatchObject([
      {
        kind: "run.failed",
        payload: {
          error: {
            code: "openai.app_server.error",
            message: expect.any(String),
          },
          recoverable: false,
        },
      },
    ]);
  });

  test("completed agent messages backfill text when no deltas streamed", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "item/completed", {
      item: {
        id: "message-1",
        text: "pong",
        type: "agentMessage",
      },
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await logger.destroy();
    const assistantMessageId = readAssistantMessageId(events());

    expect(events()).toMatchObject([
      {
        kind: "message.started",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        delivery: "best_effort",
        kind: "message.delta",
        payload: {
          contentDelta: "pong",
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "message.completed",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
    ]);
  });

  test("completed turns project final items before run finish", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        items: [
          {
            id: "message-1",
            text: "pong",
            type: "agentMessage",
          },
        ],
        status: "completed",
      },
    });
    await logger.destroy();
    const assistantMessageId = readAssistantMessageId(events());

    expect(events()).toMatchObject([
      {
        kind: "run.started",
        payload: {
          startedAt: expect.any(String),
        },
      },
      {
        kind: "message.started",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        delivery: "best_effort",
        kind: "message.delta",
        payload: {
          contentDelta: "pong",
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "message.completed",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    ]);
  });

  test("final turn items do not duplicate already completed messages", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "item/completed", {
      item: {
        id: "message-1",
        text: "pong",
        type: "agentMessage",
      },
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await bridge.handleNotification(context, "turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        items: [
          {
            id: "message-1",
            text: "pong",
            type: "agentMessage",
          },
        ],
        status: "completed",
      },
    });
    await logger.destroy();
    const assistantMessageId = readAssistantMessageId(events());

    expect(events()).toMatchObject([
      {
        kind: "message.started",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        delivery: "best_effort",
        kind: "message.delta",
        payload: {
          contentDelta: "pong",
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "message.completed",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "run.started",
        payload: {
          startedAt: expect.any(String),
        },
      },
      {
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    ]);
  });

  test("command output streams as tool result content", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "item/started", {
      item: {
        id: "cmd-1",
        type: "commandExecution",
      },
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await bridge.handleNotification(context, "item/commandExecution/outputDelta", {
      delta: "hello",
      itemId: "cmd-1",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await bridge.handleNotification(context, "item/commandExecution/outputDelta", {
      delta: " world",
      itemId: "cmd-1",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await logger.destroy();
    const assistantMessageId = readAssistantMessageId(events());

    expect(events()).toMatchObject([
      {
        kind: "message.started",
        payload: {
          messageId: assistantMessageId,
          role: "agent",
        },
      },
      {
        kind: "item.started",
        payload: {
          itemId: "cmd-1",
          itemType: "tool_call",
          parentMessageId: assistantMessageId,
          title: "Shell",
        },
      },
      {
        kind: "tool.call.updated",
        payload: {
          kind: "tool",
          parentMessageId: assistantMessageId,
          status: "running",
          title: "Shell",
          toolCallId: "cmd-1",
        },
      },
      {
        kind: "tool.call.updated",
        payload: {
          content: "hello",
          messageId: assistantMessageId,
          rawOutput: "hello",
          status: "completed",
          toolCallId: "cmd-1",
        },
      },
      {
        kind: "tool.call.updated",
        payload: {
          content: " world",
          messageId: assistantMessageId,
          rawOutput: " world",
          status: "completed",
          toolCallId: "cmd-1",
        },
      },
    ]);
    expect(events().some((event) => event.kind === "item.updated")).toBe(false);
  });

  test("turn plan updates map to the session plan custom event", async () => {
    const { bridge, context, events, logger } = createHarness();

    await bridge.handleNotification(context, "turn/plan/updated", {
      explanation: null,
      plan: [
        {
          status: "inProgress",
          step: "Inspect stream events",
        },
        {
          status: "completed",
          step: "Patch bridge",
        },
      ],
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await logger.destroy();

    expect(events()).toEqual([
      {
        kind: "plan.updated",
        payload: {
          entries: [
            {
              content: "Inspect stream events",
              priority: "medium",
              status: "in_progress",
            },
            {
              content: "Patch bridge",
              priority: "medium",
              status: "completed",
            },
          ],
          source: "driver",
        },
      },
    ]);
  });
});
