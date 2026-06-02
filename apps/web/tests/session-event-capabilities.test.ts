import { describe, expect, test } from "bun:test";

import { getSessionEventCapabilitySummary } from "../src/shared/ui/session-events/capabilities";

describe("session event capability summary", () => {
  test("derives stable header chips from runtime catalog capability self-report", () => {
    const summary = getSessionEventCapabilitySummary("claude-agent-sdk");
    const statusById = new Map(summary.map((capability) => [capability.id, capability.status]));

    expect(statusById).toEqual(
      new Map([
        ["thinking_stream", "supported"],
        ["tool_stream", "supported"],
        ["mcp_execute", "supported"],
        ["custom_tool_execute", "unsupported"],
        ["usage", "supported"],
      ]),
    );
  });
});
