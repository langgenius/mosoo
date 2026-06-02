import { describe, expect, test } from "bun:test";

import {
  appendCompactedAgUiSessionEvents,
  compactAgUiSessionEvents,
  createServerCustomEvent,
} from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

describe("AG-UI session event coalescing", () => {
  test("appends compacted batches without losing boundary merges", () => {
    const current = compactAgUiSessionEvents([
      { delta: "hello ", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    const incoming = compactAgUiSessionEvents([
      { delta: "world", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);

    expect(appendCompactedAgUiSessionEvents(current, incoming)).toEqual([
      { delta: "hello world", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
  });

  test("keeps non-adjacent messages ordered while merging adjacent deltas", () => {
    const current: AgUiSessionEvent[] = [
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "A", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
    ];
    const incoming: AgUiSessionEvent[] = [
      { delta: "B", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      { delta: "C", messageId: "assistant-2", type: "TEXT_MESSAGE_CONTENT" },
    ];

    expect(appendCompactedAgUiSessionEvents(current, incoming)).toEqual([
      { messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "AB", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
      { delta: "C", messageId: "assistant-2", type: "TEXT_MESSAGE_CONTENT" },
    ]);
  });

  test("matches full compaction when appending already compacted batches", () => {
    const cases: { current: AgUiSessionEvent[]; incoming: AgUiSessionEvent[]; name: string }[] = [
      {
        current: [{ delta: "a", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        incoming: [
          { delta: "", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
          { delta: "b", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
        ],
        name: "text content",
      },
      {
        current: [
          { delta: "a", messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_CHUNK" },
        ],
        incoming: [
          { delta: "b", messageId: "assistant-1", role: "assistant", type: "TEXT_MESSAGE_CHUNK" },
        ],
        name: "text chunk",
      },
      {
        current: [{ delta: "{", toolCallId: "tool-1", type: "TOOL_CALL_ARGS" }],
        incoming: [{ delta: "}", toolCallId: "tool-1", type: "TOOL_CALL_ARGS" }],
        name: "tool args",
      },
      {
        current: [{ delta: "{", toolCallId: "tool-1", type: "TOOL_CALL_CHUNK" }],
        incoming: [{ delta: "}", toolCallId: "tool-1", type: "TOOL_CALL_CHUNK" }],
        name: "tool chunk",
      },
      {
        current: [
          createServerCustomEvent("mosoo.session.info.updated", {
            title: "old",
          }),
        ],
        incoming: [
          createServerCustomEvent("mosoo.session.info.updated", {
            title: "new",
          }),
        ],
        name: "replaceable custom",
      },
      {
        current: [
          { delta: "a", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
          createServerCustomEvent("mosoo.session.info.updated", {
            title: "old",
          }),
        ],
        incoming: [
          { delta: "b", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
          createServerCustomEvent("mosoo.session.info.updated", {
            title: "new",
          }),
        ],
        name: "non-adjacent replaceable custom",
      },
      {
        current: [
          { delta: "a", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" },
          { runId: "run-1", threadId: "session-1", type: "RUN_STARTED" },
        ],
        incoming: [{ delta: "b", messageId: "assistant-1", type: "TEXT_MESSAGE_CONTENT" }],
        name: "separator",
      },
    ];

    for (const { current, incoming, name } of cases) {
      const appended = appendCompactedAgUiSessionEvents(
        compactAgUiSessionEvents(current),
        compactAgUiSessionEvents(incoming),
      );
      const fullCompacted = compactAgUiSessionEvents([...current, ...incoming]);

      expect(appended, name).toEqual(fullCompacted);
    }
  });
});
