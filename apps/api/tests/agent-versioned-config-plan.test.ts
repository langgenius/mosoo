import { describe, expect, test } from "bun:test";

import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import {
  createAgentConfigChangeSnapshot,
  planVersionedAgentConfigChange,
  summarizeVersionedAgentConfigChange,
} from "../src/modules/agents/application/agent-versioned-config.service";

const environment: AgentEnvironmentConfig = {
  environmentId: null,
};

const agent = {
  builtInTools: createDefaultAgentBuiltInTools(),
  description: null,
  model: "gpt-5",
  name: "Agent",
  prompt: "Help",
  provider: "openai",
  providerOptions: {},
  runtimeId: "openai-runtime",
};

describe("Agent preset change plan", () => {
  const current = createAgentConfigChangeSnapshot({
    agent,
    environment,
    mcpServerIds: [],
    skillIds: [],
  });
  test("metadata edits do not change published execution versions", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current,
      next: { ...current, name: "New name" },
    });
    expect(plan).toEqual({ fieldLabels: ["Name"], requiresDeploymentVersion: false });
    expect(summarizeVersionedAgentConfigChange(plan)).toBe("Preset updated · Name");
  });
  test.each([
    { prompt: "New instructions" },
    { model: "new-model" },
    { provider: "anthropic" },
    { runtimeId: "claude-agent-sdk" },
    { environmentId: "01J000000000000000000000B1" },
    { providerOptions: { reasoning_effort: "high" } },
    { mcpServerIds: ["01J000000000000000000000B2"] },
    { skills: [{ id: "01J000000000000000000000B3", state: "active" as const }] },
    { builtInTools: [] },
  ])("records execution edits for future consumers without a runtime action: %j", (patch) => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current,
      next: { ...current, ...patch },
    });
    expect(plan.fieldLabels).toHaveLength(1);
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan).not.toHaveProperty("action");
    expect(plan).not.toHaveProperty("requiresRuntimeOperation");
  });
  test("draft presets need no publishing step to save a different harness", () => {
    expect(
      planVersionedAgentConfigChange({
        agentStatus: "draft",
        current,
        next: { ...current, runtimeId: "claude-agent-sdk" },
      }),
    ).toEqual({ fieldLabels: ["Runtime"], requiresDeploymentVersion: false });
  });
  test("equivalent provider options do not create a version", () => {
    expect(
      planVersionedAgentConfigChange({
        agentStatus: "published",
        current: { ...current, providerOptions: { a: 1, b: 2 } },
        next: { ...current, providerOptions: { b: 2, a: 1 } },
      }),
    ).toEqual({ fieldLabels: [], requiresDeploymentVersion: false });
  });
});
