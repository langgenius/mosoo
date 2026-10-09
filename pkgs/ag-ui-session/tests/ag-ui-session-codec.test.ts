import { describe, expect, test } from "bun:test";

import { parseServerCustomEvent } from "@mosoo/ag-ui-session";

describe("AG-UI session codec boundary", () => {
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
