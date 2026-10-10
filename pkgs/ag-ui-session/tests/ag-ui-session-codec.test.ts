import { describe, expect, test } from "bun:test";

import { MOSOO_CUSTOM_EVENT, parseServerCustomEvent } from "@mosoo/ag-ui-session";

describe("AG-UI session codec boundary", () => {
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
