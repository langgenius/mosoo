import { describe, expect, test } from "bun:test";

import type { DriverEventEnvelope } from "@mosoo/driver-protocol";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope, RuntimeEventKind } from "@mosoo/runtime-events";

import type { ProjectedRuntimeEventRecord } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { RuntimeEventPersistenceCompactor } from "../src/modules/runtime/infrastructure/driver-instance/runtime-event-persistence-compactor";
import { filterDurablyAcceptedRuntimeStreamReplays } from "../src/modules/runtime/infrastructure/driver-instance/runtime-event-replay-filter";

function runtimeEvent(input: {
  delivery?: RuntimeEventEnvelope["delivery"];
  id: string;
  kind: RuntimeEventKind;
  occurredAtMs: number;
  payload: unknown;
  runId?: string;
}): RuntimeEventEnvelope {
  return createRuntimeEvent({
    id: input.id,
    kind: input.kind,
    occurredAt: new Date(input.occurredAtMs).toISOString(),
    payload: input.payload,
    ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    sessionId: "session-1",
  });
}

function record(input: {
  delivery?: RuntimeEventEnvelope["delivery"];
  id: string;
  kind: RuntimeEventKind;
  occurredAtMs: number;
  payload: unknown;
  runId?: string;
}): ProjectedRuntimeEventRecord {
  const event = runtimeEvent(input);

  return {
    event,
    occurredAt: input.occurredAtMs,
    sourceEventId: `source-${input.id}`,
  };
}

function envelope(projectedRecord: ProjectedRuntimeEventRecord): DriverEventEnvelope {
  return {
    event: projectedRecord.event,
    eventId: projectedRecord.sourceEventId ?? projectedRecord.event.id,
    occurredAt: projectedRecord.occurredAt,
  };
}

describe("runtime event persistence compactor", () => {
  test("stores message and thinking streams as complete content events", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    expect(
      compactor.compact([
        record({
          id: "message-start",
          kind: "message.started",
          occurredAtMs: 1_000,
          payload: { messageId: "message-1", role: "agent" },
          runId: "run-1",
        }),
        record({
          id: "message-delta-1",
          kind: "message.delta",
          occurredAtMs: 1_010,
          payload: { contentDelta: "Hello ", messageId: "message-1", role: "agent" },
          runId: "run-1",
        }),
      ]),
    ).toEqual([]);

    const compacted = compactor.compact([
      record({
        id: "message-delta-2",
        kind: "message.delta",
        occurredAtMs: 1_020,
        payload: { contentDelta: "world", messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      record({
        id: "message-end",
        kind: "message.completed",
        occurredAtMs: 1_030,
        payload: { messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      record({
        id: "thought-start",
        kind: "thought.started",
        occurredAtMs: 1_040,
        payload: { channel: "summary", thoughtId: "thought-1" },
        runId: "run-1",
      }),
      record({
        id: "thought-delta",
        kind: "thought.delta",
        occurredAtMs: 1_050,
        payload: { channel: "summary", contentDelta: "Check inputs", thoughtId: "thought-1" },
        runId: "run-1",
      }),
      record({
        id: "thought-end",
        kind: "thought.completed",
        occurredAtMs: 1_060,
        payload: { channel: "summary", thoughtId: "thought-1" },
        runId: "run-1",
      }),
    ]);

    expect(compacted.map((entry) => entry.event.kind)).toEqual([
      "message.added",
      "thought.completed",
    ]);
    expect(compacted[0]?.occurredAt).toBe(1_000);
    expect(compacted[0]?.sourceEventId).toBe("source-message-end");
    expect(compacted[0]?.event.payload).toMatchObject({
      content: "Hello world",
      messageId: "message-1",
      role: "agent",
    });
    expect(compacted[1]?.event.payload).toMatchObject({
      channel: "summary",
      content: "Check inputs",
      thoughtId: "thought-1",
    });
  });

  test("appends repeated text deltas instead of treating them as snapshots", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    const compacted = compactor.compact([
      record({
        id: "message-delta-1",
        kind: "message.delta",
        occurredAtMs: 1_000,
        payload: { contentDelta: "a", messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      record({
        id: "message-delta-2",
        kind: "message.delta",
        occurredAtMs: 1_010,
        payload: { contentDelta: "a", messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      record({
        id: "message-end",
        kind: "message.completed",
        occurredAtMs: 1_020,
        payload: { messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
    ]);

    expect(compacted[0]?.event.payload).toMatchObject({
      content: "aa",
      messageId: "message-1",
    });
  });

  test("preserves structured message.added text blocks", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    const compacted = compactor.compact([
      record({
        id: "user-message",
        kind: "message.added",
        occurredAtMs: 1_000,
        payload: {
          content: [
            { text: "hello ", type: "text" },
            { text: "world", type: "text" },
          ],
          messageId: "message-1",
          role: "user",
        },
        runId: "run-1",
      }),
    ]);

    expect(compacted.map((entry) => entry.event.kind)).toEqual(["message.added"]);
    expect(compacted[0]?.event.payload).toMatchObject({
      content: "hello world",
      messageId: "message-1",
      role: "user",
    });
  });

  test("preserves an existing message role when terminal events omit it", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    const compacted = compactor.compact([
      record({
        id: "message-start",
        kind: "message.started",
        occurredAtMs: 1_000,
        payload: { messageId: "message-1", role: "user" },
        runId: "run-1",
      }),
      record({
        id: "message-delta",
        kind: "message.delta",
        occurredAtMs: 1_010,
        payload: { contentDelta: "hello", messageId: "message-1" },
        runId: "run-1",
      }),
      record({
        id: "message-end",
        kind: "message.completed",
        occurredAtMs: 1_020,
        payload: { messageId: "message-1" },
        runId: "run-1",
      }),
    ]);

    expect(compacted[0]?.event.payload).toMatchObject({
      content: "hello",
      messageId: "message-1",
      role: "user",
    });
  });

  test("stores tool call snapshots as one completed call", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    expect(
      compactor.compact([
        record({
          id: "tool-start",
          kind: "item.started",
          occurredAtMs: 2_000,
          payload: {
            itemId: "tool-1",
            itemType: "tool_call",
            parentMessageId: "message-1",
            title: "Search",
          },
          runId: "run-1",
        }),
        record({
          id: "tool-running",
          kind: "tool.call.updated",
          occurredAtMs: 2_010,
          payload: {
            rawInput: '{"q":',
            status: "running",
            toolCallId: "tool-1",
          },
          runId: "run-1",
        }),
      ]),
    ).toEqual([]);

    const compacted = compactor.compact([
      record({
        id: "tool-input",
        kind: "tool.call.updated",
        occurredAtMs: 2_020,
        payload: {
          rawInput: '"cats"}',
          status: "running",
          toolCallId: "tool-1",
        },
        runId: "run-1",
      }),
      record({
        id: "tool-output",
        kind: "tool.call.updated",
        occurredAtMs: 2_050,
        payload: {
          messageId: "message-1",
          rawOutput: "ok",
          status: "completed",
          toolCallId: "tool-1",
        },
        runId: "run-1",
      }),
      record({
        id: "tool-end",
        kind: "item.completed",
        occurredAtMs: 2_060,
        payload: {
          itemId: "tool-1",
          itemType: "tool_call",
          status: "completed",
        },
        runId: "run-1",
      }),
    ]);

    expect(compacted.map((entry) => entry.event.kind)).toEqual(["tool.call.updated"]);
    expect(compacted[0]?.occurredAt).toBe(2_000);
    expect(compacted[0]?.sourceEventId).toBe("source-tool-end");
    expect(compacted[0]?.event.payload).toMatchObject({
      messageId: "message-1",
      parentMessageId: "message-1",
      rawInput: '{"q":"cats"}',
      rawOutput: "ok",
      status: "completed",
      title: "Search",
      toolCallId: "tool-1",
    });
  });

  test("waits until run end before storing repeated completed tool snapshots", () => {
    const compactor = new RuntimeEventPersistenceCompactor();

    expect(
      compactor.compact([
        record({
          id: "tool-start",
          kind: "item.started",
          occurredAtMs: 3_000,
          payload: {
            itemId: "tool-1",
            itemType: "tool_call",
            title: "Shell",
          },
          runId: "run-1",
        }),
      ]),
    ).toEqual([]);
    expect(
      compactor.compact([
        record({
          id: "tool-snapshot-1",
          kind: "tool.call.updated",
          occurredAtMs: 3_010,
          payload: {
            rawOutput: "one",
            status: "completed",
            toolCallId: "tool-1",
          },
          runId: "run-1",
        }),
      ]),
    ).toEqual([]);
    expect(
      compactor.compact([
        record({
          id: "tool-snapshot-2",
          kind: "tool.call.updated",
          occurredAtMs: 3_020,
          payload: {
            rawOutput: "one two",
            status: "completed",
            toolCallId: "tool-1",
          },
          runId: "run-1",
        }),
      ]),
    ).toEqual([]);

    const compacted = compactor.compact([
      record({
        id: "run-end",
        kind: "run.completed",
        occurredAtMs: 3_100,
        payload: { stopReason: "end_turn" },
        runId: "run-1",
      }),
    ]);

    expect(compacted.map((entry) => entry.event.kind)).toEqual([
      "tool.call.updated",
      "run.completed",
    ]);
    expect(compacted[0]?.event.payload).toMatchObject({
      rawOutput: "one two",
      status: "completed",
      title: "Shell",
      toolCallId: "tool-1",
    });
  });

  test("drops stream fragment replays shadowed by durable terminal receipts", () => {
    const messageStart = record({
      id: "message-start",
      kind: "message.started",
      occurredAtMs: 4_000,
      payload: { messageId: "message-1", role: "agent" },
      runId: "run-1",
    });
    const messageDelta = record({
      id: "message-delta",
      kind: "message.delta",
      occurredAtMs: 4_010,
      payload: { contentDelta: "Hello", messageId: "message-1", role: "agent" },
      runId: "run-1",
    });
    const messageEnd = record({
      id: "message-end",
      kind: "message.completed",
      occurredAtMs: 4_020,
      payload: { messageId: "message-1", role: "agent" },
      runId: "run-1",
    });

    expect(
      filterDurablyAcceptedRuntimeStreamReplays(
        [messageStart, messageDelta, messageEnd].map(envelope),
        new Set(["source-message-end"]),
      ),
    ).toEqual([]);
  });

  test("drops open stream fragment replays shadowed by a durable run terminal receipt", () => {
    const messageDelta = record({
      id: "message-delta",
      kind: "message.delta",
      occurredAtMs: 5_000,
      payload: { contentDelta: "partial", messageId: "message-1", role: "agent" },
      runId: "run-1",
    });
    const toolDelta = record({
      id: "tool-delta",
      kind: "tool.call.updated",
      occurredAtMs: 5_010,
      payload: { rawInput: "{}", status: "running", toolCallId: "tool-1" },
      runId: "run-1",
    });
    const runEnd = record({
      id: "run-end",
      kind: "run.completed",
      occurredAtMs: 5_100,
      payload: { stopReason: "end_turn" },
      runId: "run-1",
    });

    expect(
      filterDurablyAcceptedRuntimeStreamReplays(
        [messageDelta, toolDelta, runEnd].map(envelope),
        new Set(["source-run-end"]),
      ),
    ).toEqual([]);
  });
});
