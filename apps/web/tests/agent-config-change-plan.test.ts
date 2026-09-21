import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import { toAgentConfigChangeSnapshot } from "../src/routes/agent/components/editor/draft";

const ENVIRONMENT_ID = "01J000000000000000000000B1";
const MCP_SERVER_ID = "01J000000000000000000000B2";

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

describe("agent config change plan", () => {
  test("classifies prompt-only edits as restart-process", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ prompt: "Help more" })),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("restart-process");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.agentStatePreserved).toBe(false);
  });

  test("uses recreate-preserving-state as the max rank for environment changes", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(
        draft({
          prompt: "Help more",
          environmentId: ENVIRONMENT_ID,
        }),
      ),
      saved: toAgentConfigChangeSnapshot(draft()),
    });

    expect(plan.action).toBe("recreate-preserving-state");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.fieldLabels.length).toBeGreaterThan(1);
  });

  test("preserves legacy shared-workspace maintenance for published config changes", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft({ prompt: "Help more" }), "pet"),
      saved: toAgentConfigChangeSnapshot(draft(), "pet"),
    });

    expect(plan.action).toBe("restart-process");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(plan.agentStatePreserved).toBe(true);
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
    expect(plan.requiresRuntimeOperation).toBe(false);
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
    expect(plan.requiresRuntimeOperation).toBe(false);
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

  test("historical type labels do not create a configuration change", () => {
    const plan = classifyAgentConfigChanges({
      agentStatus: "published",
      current: toAgentConfigChangeSnapshot(draft(), "cattle"),
      saved: toAgentConfigChangeSnapshot(draft(), "pet"),
    });

    expect(plan.action).toBe("direct-update");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(plan.fieldLabels).toEqual([]);
  });
});
