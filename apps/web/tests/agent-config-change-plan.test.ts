import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import { toAgentConfigChangeSnapshot } from "../src/routes/agent/components/editor/draft";

function draft(overrides: Partial<AgentEditorDraft> = {}): AgentEditorDraft {
  return {
    builtInTools: createDefaultAgentBuiltInTools(),
    description: "Description",
    environmentId: null,
    mcpServers: [],
    model: "gpt-5",
    name: "Agent",
    prompt: "Help",
    provider: "openai",
    providerOptions: {},
    runtime: "openai-runtime",
    skills: [],
    ...overrides,
  };
}

describe("preset editor snapshots", () => {
  test("maps a harness edit to future-session configuration", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(
        draft({ runtime: "claude-agent-sdk", prompt: "New instructions" }),
      ),
      saved: toAgentConfigChangeSnapshot(draft()),
    });
    expect(plan).toEqual({
      fieldLabels: ["System prompt", "Runtime"],
      requiresDeploymentVersion: true,
    });
  });
  test("editor snapshots contain no runtime ownership type", () => {
    expect(toAgentConfigChangeSnapshot(draft())).not.toHaveProperty("kind");
  });
});
