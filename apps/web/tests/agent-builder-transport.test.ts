import { describe, expect, test } from "bun:test";

import {
  createAgentBuilderSystemAgentAddress,
  resolveAgentBuilderSystemAgentAddress,
} from "../src/domains/agent-builder/api/agent-builder-transport";

describe("Agent Builder transport boundary", () => {
  test("builds a system agent HTTP address without leaking unsafe path characters", () => {
    const address = createAgentBuilderSystemAgentAddress({
      agentId: "agent_01",
      threadId: "thread_02",
    });
    const unsafeAddress = createAgentBuilderSystemAgentAddress({
      agentId: "agent/with space",
      threadId: "thread?with=value",
    });

    expect(address.agent).toBe("agent-builder-system-agent");
    expect(address.threadId).toBe("thread_02");
    expect(address.publicPath.startsWith("/api/agents/")).toBe(true);
    expect(unsafeAddress.publicPath).not.toContain(" ");
    expect(unsafeAddress.publicPath).not.toContain("?");
  });

  test("waits for the Builder thread before resolving the address", () => {
    expect(
      resolveAgentBuilderSystemAgentAddress({
        agentId: "agent_01",
        threadId: null,
      }),
    ).toBeNull();

    expect(
      resolveAgentBuilderSystemAgentAddress({
        agentId: "agent_01",
        threadId: "thread_02",
      }),
    ).toMatchObject({
      threadId: "thread_02",
    });
  });
});
