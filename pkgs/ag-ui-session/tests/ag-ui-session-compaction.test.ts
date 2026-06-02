import { describe, expect, test } from "bun:test";

import {
  EventType,
  appendCompactedAgUiSessionEvents,
  compactAgUiSessionEvents,
  createServerCustomEvent,
  getAgUiSessionEventDeltaLength,
  isAgUiSessionEventBufferable,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

describe("AG-UI session event compaction", () => {
  test("merges adjacent streamed text and tool deltas", () => {
    const events: AgUiSessionEvent[] = [
      { delta: "Hel", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
      { delta: "lo", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
      { delta: '{"cmd"', toolCallId: "tool-1", type: EventType.TOOL_CALL_ARGS },
      { delta: ':"ls"}', toolCallId: "tool-1", type: EventType.TOOL_CALL_ARGS },
    ];

    expect(compactAgUiSessionEvents(events)).toEqual([
      { delta: "Hello", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
      { delta: '{"cmd":"ls"}', toolCallId: "tool-1", type: EventType.TOOL_CALL_ARGS },
    ]);
  });

  test("merges adjacent reasoning deltas for the same thought", () => {
    const events: AgUiSessionEvent[] = [
      { delta: "The user", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
      { delta: " just sent", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
      { delta: ' "ping".', messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
    ];

    expect(compactAgUiSessionEvents(events)).toEqual([
      {
        delta: 'The user just sent "ping".',
        messageId: "thought-1",
        type: EventType.REASONING_MESSAGE_CONTENT,
      },
    ]);
  });

  test("keeps reasoning deltas for distinct thoughts separate", () => {
    const events: AgUiSessionEvent[] = [
      { delta: "first", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
      { delta: "second", messageId: "thought-2", type: EventType.REASONING_MESSAGE_CONTENT },
    ];

    expect(compactAgUiSessionEvents(events)).toEqual(events);
  });

  test("drops empty reasoning deltas", () => {
    const events: AgUiSessionEvent[] = [
      { delta: "kept", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
      { delta: "", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
    ];

    expect(compactAgUiSessionEvents(events)).toEqual([
      { delta: "kept", messageId: "thought-1", type: EventType.REASONING_MESSAGE_CONTENT },
    ]);
  });

  test("replaces coalescing custom events by name", () => {
    const first = createServerCustomEvent("mosoo.session.info.updated", {
      title: "Draft",
    });
    const second = createServerCustomEvent("mosoo.session.info.updated", {
      title: "Final",
    });

    expect(
      compactAgUiSessionEvents([
        { delta: "Hel", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
        first,
        { delta: "lo", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
        second,
      ]),
    ).toEqual([
      { delta: "Hello", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
      second,
    ]);
  });

  test("appends compacted batches using full compaction semantics", () => {
    const first = createServerCustomEvent("mosoo.session.info.updated", {
      title: "Draft",
    });
    const second = createServerCustomEvent("mosoo.session.info.updated", {
      title: "Final",
    });

    expect(
      appendCompactedAgUiSessionEvents(
        compactAgUiSessionEvents([
          { delta: "Hel", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
          first,
        ]),
        compactAgUiSessionEvents([
          { delta: "lo", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
          second,
        ]),
      ),
    ).toEqual([
      { delta: "Hello", messageId: "message-1", type: EventType.TEXT_MESSAGE_CONTENT },
      second,
    ]);
  });

  test("identifies bufferable events and measures streamed payload size", () => {
    expect(
      isAgUiSessionEventBufferable({
        delta: "hello",
        messageId: "message-1",
        type: EventType.TEXT_MESSAGE_CONTENT,
      }),
    ).toBe(true);
    expect(
      getAgUiSessionEventDeltaLength({
        delta: "hello",
        messageId: "message-1",
        type: EventType.TEXT_MESSAGE_CONTENT,
      }),
    ).toBe(5);
    expect(
      isAgUiSessionEventBufferable({
        runId: "run-1",
        threadId: "session-1",
        type: EventType.RUN_STARTED,
      }),
    ).toBe(false);
    expect(
      getAgUiSessionEventDeltaLength({
        runId: "run-1",
        threadId: "session-1",
        type: EventType.RUN_STARTED,
      }),
    ).toBe(0);
  });
});
