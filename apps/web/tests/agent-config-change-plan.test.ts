import { describe, expect, test } from "bun:test";

import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import { toAgentConfigChangeSnapshot } from "../src/routes/agent/components/editor/draft";

const ENVIRONMENT_ID = "01J000000000000000000000B1";
const MCP_SERVER_ID = "01J000000000000000000000B2";
const SPACE_ID = "01J000000000000000000000B3";

function draft(overrides: Partial<AgentEditorDraft> = {}): AgentEditorDraft {
  return {
    componentDecisions: {},
    description: "Description",
    environmentId: null,
    mcpServers: [],
    model: "gpt-5",
    name: "Agent",
    kind: "pet",
    prompt: "Help",
    provider: "openai",
    providerOptions: {},
    runtime: "openai-runtime",
    skills: [],
    spaces: [],
    ...overrides,
  };
}

describe("agent config change plan", () => {
  test("classifies prompt-only edits as restart-process", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ prompt: "Help more" })),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("restart-process");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(plan.agentStatePreserved).toBe(true);
  });

  test("uses recreate-preserving-state as the max rank for environment and space changes", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(
        draft({
          prompt: "Help more",
          environmentId: ENVIRONMENT_ID,
          spaces: [{ id: SPACE_ID, name: "Workspace" }],
        }),
      ),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("recreate-preserving-state");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(plan.fieldLabels.length).toBeGreaterThan(1);
  });

  test("saves published Cattle config changes for future sessions without runtime operations", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ kind: "cattle", prompt: "Help more" })),
      saved: toAgentConfigChangeSnapshot(draft({ kind: "cattle" })),
    });

    expect(plan.action).toBe("restart-process");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.agentStatePreserved).toBe(false);
  });

  test("classifies MCP binding edits as patch-and-restart", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(
        draft({
          mcpServers: [
            {
              credentialMode: "runtime_resolved",
              enabled: true,
              id: MCP_SERVER_ID,
              name: "Linear MCP",
              type: "web",
              url: "https://mcp.linear.app",
            },
          ],
        }),
      ),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("patch-and-restart");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
  });

  test("classifies advanced provider option edits as patch-and-restart", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(
        draft({
          providerOptions: {
            reasoning_effort: "high",
          },
        }),
      ),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("patch-and-restart");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(plan.fieldLabels).toEqual(["Advanced settings"]);
  });

  test("requires fork-agent for published runtime changes", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ runtime: "claude-agent-sdk" })),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("fork-agent");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.agentStatePreserved).toBe(false);
  });

  test("requires fork-agent for published kind changes", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ kind: "cattle" })),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("fork-agent");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.agentStatePreserved).toBe(false);
  });

  test("keeps published kind changes on fork-agent even when runtime fields also changed", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ kind: "cattle", prompt: "Help more" })),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("fork-agent");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.fieldLabels).toHaveLength(2);
  });
});
