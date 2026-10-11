import { describe, expect, test } from "bun:test";

import { MOSOO_CUSTOM_EVENT, parseServerCustomEvent } from "@mosoo/ag-ui-session";

describe("AG-UI session codec boundary", () => {
  test("validates reasoning snapshot offsets and preserves empty replacements", () => {
    const name = MOSOO_CUSTOM_EVENT.sessionReasoningUpdated.name;
    expect(
      parseServerCustomEvent(name, { content: "", messageId: "thought-1", offset: 0 }),
    ).toMatchObject({ value: { content: "", offset: 0 } });
    for (const value of [
      { content: "text", messageId: "thought-1", offset: -1 },
      { content: "text", messageId: "thought-1", offset: 0.5 },
      { content: "text", messageId: "thought-1", offset: Number.MAX_SAFE_INTEGER + 1 },
      { content: null, messageId: "thought-1", offset: 0 },
    ]) {
      expect(() => parseServerCustomEvent(name, value)).toThrow();
    }
  });

  test("validates tool input snapshots before replacing tool arguments", () => {
    for (const payload of [
      { rawInput: {}, toolCallId: "tool-1" },
      { rawInput: "{}", toolCallId: "" },
      { rawInput: "{}" },
    ]) {
      expect(() =>
        parseServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionToolInputUpdated.name, payload),
      ).toThrow();
    }
  });

  test("rejects malformed custom session payloads before they reach live-state reducers", () => {
    expect(() =>
      parseServerCustomEvent("mosoo.session.permissions.updated", {
        permissionRequests: [
          {
            title: "Run command",
            toolCallId: "tool-1",
          },
        ],
      }),
    ).toThrow();
  });
});
