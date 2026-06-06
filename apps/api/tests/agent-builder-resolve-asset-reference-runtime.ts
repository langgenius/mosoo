import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import { createResolveAssetReferenceTool } from "../src/modules/agent-builder/application/tools/resolve-asset-reference.tool";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createResolveFixture, viewer } from "./agent-builder-resolve-asset-reference-fixtures";

export function plannerContextWithSpaceQuestion(): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: "01J00000000000000000000009",
      kind: "pet",
      organizationId: "01J00000000000000000000006",
      status: "draft",
    },
    assets: {
      changesSinceLastTurn: {
        channels: { added: [], removed: [], updated: [] },
        environments: { added: [], removed: [], updated: [] },
        mcpServers: { added: [], removed: [], updated: [] },
        selectedSpaceFiles: { added: [], removed: [], updated: [] },
        skills: { added: [], removed: [], updated: [] },
        spaces: { added: [], removed: [], updated: [] },
      },
      currentIndex: {
        channels: [],
        environments: [],
        mcpServers: [],
        selectedSpaceFiles: [],
        skills: [],
        spaces: [],
      },
      draftBindings: {
        channelIds: [],
        environmentId: null,
        mcpServerIds: [],
        parseError: null,
        parseStatus: "parsed",
        skillIds: [],
        spaceIds: [],
      },
      observedAt: "2026-05-20T00:00:00.000Z",
      snapshotHash: "asset-hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "blocked"],
      forbiddenWrites: [],
      requiresLlmPlanner: true,
    },
    conversation: { recentMessages: [] },
    draft: {
      revision: "draft-rev-1",
      yaml: "version: 1\nkind: pet\n",
    },
    historicalOpenNodes: [
      {
        actions: [],
        kind: "question",
        nodeKey: "prepare_create_space_support_kb_space_similar",
        operation: "ask",
        requiresConfirmation: false,
        status: "pending",
        summary:
          "Visible Spaces have similar names to requested create name support-kb-space. Candidate Spaces: 1. support-kb; 2. support-kb-2.",
        targetType: "space",
      },
    ],
    plannerRunId: "planner-run-1",
    readiness: {
      checkedAt: "2026-05-20T00:00:00.000Z",
      errorCount: 0,
      issues: [],
      ready: true,
      warningCount: 0,
    },
    systemAgent: {
      credentialSource: "provider_database",
      model: { modelId: "gpt-5.4", provider: "openai" },
    },
    threadId: "thread-1",
    turn: {
      inputKind: "user_message",
      inputText: "用第二个",
      triggerMessageId: "message-1",
    },
    version: 1,
  };
}

export function plannerContextWithEnvironmentQuestion(): AgentBuilderPlannerContext {
  return {
    ...plannerContextWithSpaceQuestion(),
    historicalOpenNodes: [
      {
        actions: [],
        kind: "question",
        nodeKey: "prepare_create_environment_linear_limited_environment_similar",
        operation: "ask",
        requiresConfirmation: false,
        status: "pending",
        summary:
          "Visible Environments have similar names to requested create name linear-limited-environment. Candidate Environments: 1. Linear limited environment; 2. Python data environment.",
        targetType: "environment",
      },
    ],
    turn: {
      inputKind: "user_message",
      inputText: "用第一个",
      triggerMessageId: "message-1",
    },
  };
}

export function plannerContextWithMcpQuestion(): AgentBuilderPlannerContext {
  return {
    ...plannerContextWithSpaceQuestion(),
    historicalOpenNodes: [
      {
        actions: [],
        kind: "question",
        nodeKey: "choose_mcp_server",
        operation: "ask",
        requiresConfirmation: false,
        status: "pending",
        summary:
          "Multiple MCP Servers matched. Candidate MCP Servers: 1. Linear MCP; 2. GitHub MCP.",
        targetType: "mcp",
      },
    ],
    turn: {
      inputKind: "user_message",
      inputText: "用第二个",
      triggerMessageId: "message-1",
    },
  };
}

export function plannerContextWithSkillQuestion(): AgentBuilderPlannerContext {
  return {
    ...plannerContextWithSpaceQuestion(),
    historicalOpenNodes: [
      {
        actions: [],
        kind: "question",
        nodeKey: "choose_skill",
        operation: "ask",
        requiresConfirmation: false,
        status: "pending",
        summary: "Multiple Skills matched. Candidate Skills: 1. Billing Skill; 2. Support Skill.",
        targetType: "skill",
      },
    ],
    turn: {
      inputKind: "user_message",
      inputText: "用第一个",
      triggerMessageId: "message-1",
    },
  };
}

export function createRuntimeWithResolveAssets(
  fixture = createResolveFixture(),
  context?: AgentBuilderPlannerContext,
) {
  return createAgentBuilderToolRuntime({
    tools: [
      createResolveAssetReferenceTool({
        bindings: {} as ApiBindings,
        collectSummaries: async () => fixture,
        ...(context === undefined ? {} : { context }),
        draftYaml: "version: 1",
        organizationId: "01J00000000000000000000006",
        viewer,
      }),
    ],
  });
}

export function outputCandidates(
  output: AgentBuilderToolPayload | null,
): AgentBuilderToolPayload[] {
  const candidates = output?.["candidates"];

  if (!Array.isArray(candidates)) {
    throw new Error("Expected resolve_asset_reference output candidates.");
  }

  return candidates.map((candidate, index) => {
    if (!isToolPayload(candidate)) {
      throw new Error(
        `Expected resolve_asset_reference output candidate ${index} to be an object.`,
      );
    }

    return candidate;
  });
}

export function sortedStrings(values: readonly unknown[]): string[] {
  return values.map(String).toSorted((left, right) => left.localeCompare(right));
}

function isToolPayload(value: unknown): value is AgentBuilderToolPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
