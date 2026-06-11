import { describe, expect, test } from "bun:test";

import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";

import {
  createAgentConfigChangeSnapshot,
  planVersionedAgentConfigChange,
  summarizeVersionedAgentConfigChange,
} from "../src/modules/agents/application/agent-versioned-config.service";

const environment: AgentEnvironmentConfig = {
  boundSpaceIds: [],
  environmentId: null,
};

const agent = {
  description: null,
  kind: "pet" as const,
  model: "gpt-5",
  name: "Agent",
  prompt: "Help",
  provider: "openai",
  providerOptions: {},
  runtimeId: "openai-runtime",
};

describe("agent versioned config plan", () => {
  test("keeps direct metadata edits out of runtime deployment versions", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent: {
          ...agent,
          name: "Renamed Agent",
        },
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("direct-update");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe("Save changes · Name");
  });

  test("uses the shared runtime action labels for version summaries", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent,
        environment: {
          ...environment,
          environmentId: "env-2",
        },
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("recreate-preserving-state");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe("Recreate sandbox · Environment");
  });

  test("creates a deployment version for published Cattle config without runtime operation", () => {
    const cattleAgent = {
      ...agent,
      kind: "cattle" as const,
    };
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent: cattleAgent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent: {
          ...cattleAgent,
          prompt: "Help more",
        },
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("restart-process");
    expect(plan.actionLabel).toBe("Save for new sessions");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe("Save for new sessions · System prompt");
  });

  test("classifies MCP binding edits as patch-and-restart", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: ["mcp_linear"],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("patch-and-restart");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe(
      "Patch native config + restart · MCP Servers",
    );
  });

  test("classifies advanced provider option edits as patch-and-restart", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent: {
          ...agent,
          providerOptions: {
            reasoning_effort: "high",
          },
        },
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("patch-and-restart");
    expect(plan.requiresDeploymentVersion).toBe(true);
    expect(plan.requiresRuntimeOperation).toBe(true);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe(
      "Patch native config + restart · Advanced settings",
    );
  });

  test("requires fork-agent for published kind changes", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent: {
          ...agent,
          kind: "cattle",
        },
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("fork-agent");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe("Fork Agent · Agent type");
  });

  test("keeps published kind changes on fork-agent even when versioned fields also changed", () => {
    const plan = planVersionedAgentConfigChange({
      agentStatus: "published",
      current: createAgentConfigChangeSnapshot({
        agent,
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
      next: createAgentConfigChangeSnapshot({
        agent: {
          ...agent,
          kind: "cattle",
          prompt: "Help more",
        },
        environment,
        mcpServerIds: [],
        skillIds: [],
      }),
    });

    expect(plan.action).toBe("fork-agent");
    expect(plan.requiresDeploymentVersion).toBe(false);
    expect(plan.requiresRuntimeOperation).toBe(false);
    expect(summarizeVersionedAgentConfigChange(plan)).toBe(
      "Fork Agent · Agent type, System prompt",
    );
  });
});
