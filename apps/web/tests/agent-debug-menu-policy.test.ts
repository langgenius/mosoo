import { describe, expect, test } from "bun:test";

import { canShowAgentDebugMenuItem } from "../src/routes/agent/agent-debug-menu-policy";

describe("agent debug menu policy", () => {
  test("Assistant Agent V1 exposes Terminal but defers File Browser and System Log", () => {
    const ownerAssistantAgent = {
      agentKind: "pet",
      viewerRole: "owner",
    } as const;

    expect(canShowAgentDebugMenuItem({ ...ownerAssistantAgent, itemId: "terminal" })).toBe(true);
    expect(canShowAgentDebugMenuItem({ ...ownerAssistantAgent, itemId: "files" })).toBe(false);
    expect(canShowAgentDebugMenuItem({ ...ownerAssistantAgent, itemId: "system-log" })).toBe(false);
  });

  test("Task Agent and non-owner viewers do not get the owner debug Terminal", () => {
    expect(
      canShowAgentDebugMenuItem({
        agentKind: "cattle",
        itemId: "terminal",
        viewerRole: "owner",
      }),
    ).toBe(false);
    expect(
      canShowAgentDebugMenuItem({
        agentKind: "pet",
        itemId: "terminal",
        viewerRole: "admin",
      }),
    ).toBe(false);
  });
});
