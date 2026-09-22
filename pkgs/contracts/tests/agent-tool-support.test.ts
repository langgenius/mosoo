import { expect, test } from "bun:test";

import { getAgentBuiltInToolSupportError } from "../src/agent/agent.contract";

test("built-in restrictions are admitted only for Claude, without rewriting settings", () => {
  const tools = [{ name: "bash" as const, enabled: false }];
  expect(getAgentBuiltInToolSupportError("claude-agent-sdk", tools)).toBeNull();
  for (const runtime of ["openai-runtime", "acp-fallback", "unknown"]) {
    expect(getAgentBuiltInToolSupportError(runtime, tools)).toContain("does not support disabling");
    expect(getAgentBuiltInToolSupportError(runtime, [])).toBeNull();
    expect(getAgentBuiltInToolSupportError(runtime, [{ name: "bash", enabled: true }])).toBeNull();
  }
  expect(tools[0]?.enabled).toBe(false);
});
