import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
} from "@mosoo/contracts/agent-builder";
import type { McpServerId, SkillId } from "@mosoo/id";

import {
  parseAccountId,
  parseAgentBuilderMessageId,
  parseAgentBuilderPlannerRunId,
  parseAgentBuilderThreadId,
  parseAgentId,
  parseAppId,
  parseEnvironmentId,
  parseMcpServerId,
  parseSkillId,
} from "../src/modules/agent-builder/application/agent-builder-ids";

function platformId(index: number): string {
  return `01J000000000000000000${String(index).padStart(5, "0")}`;
}

export const NORMALIZER_IDS = {
  account: parseAccountId(platformId(101)),
  agent: parseAgentId(platformId(102)),
  app: parseAppId(platformId(107)),
  environmentLinear: parseEnvironmentId(platformId(103)),
  environmentSystemDefault: parseEnvironmentId(platformId(104)),
  mcpNeedsAuth: parseMcpServerId(platformId(105)),
  mcpKeep: parseMcpServerId(platformId(113)),
  mcpRemove: parseMcpServerId(platformId(114)),
  message: parseAgentBuilderMessageId(platformId(106)),
  plannerRun: parseAgentBuilderPlannerRunId(platformId(108)),
  thread: parseAgentBuilderThreadId(platformId(112)),
} as const;

function defaultDraftYaml(assetLines: readonly string[]): string {
  return [
    "version: 1",
    "kind: pet",
    "identity:",
    "  name: Old Agent",
    "  description: Old description.",
    "runtime:",
    "  id: claude-agent-sdk",
    "  provider: anthropic",
    "  model: claude-sonnet-4-5",
    "prompt: Old prompt.",
    "environment:",
    "  environmentId: null",
    "assets:",
    ...assetLines,
  ].join("\n");
}

export function normalizerSkillId(index: number): SkillId {
  return parseSkillId(platformId(1_000 + index));
}

export function plannerContext(): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: NORMALIZER_IDS.agent,
      appId: NORMALIZER_IDS.app,
      baseConfigApplied: true,
      kind: "pet",
      status: "draft",
    },
    assets: {
      changesSinceLastTurn: {
        environments: { added: [], removed: [], updated: [] },
        mcpServers: { added: [], removed: [], updated: [] },
        skills: { added: [], removed: [], updated: [] },
      },
      currentIndex: {
        environments: [],
        mcpServers: [
          {
            bindingState: "not_bound",
            hash: "mcp_hash",
            id: NORMALIZER_IDS.mcpNeedsAuth,
            kind: "mcp_server",
            name: "Needs Auth MCP",
          },
        ],
        skills: [],
      },
      draftBindings: {
        environmentId: null,
        mcpServerIds: [],
        parseError: null,
        parseStatus: "parsed",
        skillIds: [],
      },
      observedAt: "2026-05-18T00:00:00.000Z",
      snapshotHash: "asset_hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "action", "blocked"],
      forbiddenWrites: [],
      requiresLlmPlanner: true,
    },
    conversation: { recentMessages: [] },
    draft: {
      revision: "draft_hash",
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: claude-agent-sdk",
        "  provider: anthropic",
        "  model: claude-sonnet-4-5",
        "prompt: Old prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills: []",
        "  mcpServers: []",
      ].join("\n"),
    },
    historicalOpenNodes: [],
    memory: {
      diagnostics: [],
    },
    plannerRunId: NORMALIZER_IDS.plannerRun,
    preview: {
      messageCount: 0,
      opened: false,
      sessionExists: false,
    },
    readiness: {
      checkedAt: "2026-05-18T00:00:00.000Z",
      errorCount: 0,
      issues: [],
      ready: true,
      warningCount: 0,
    },
    systemAgent: {
      credentialSource: "provider_database",
      model: {
        modelId: "o3-mini",
        provider: "openai",
      },
    },
    threadId: NORMALIZER_IDS.thread,
    turn: {
      inputKind: "user_message",
      inputText: "update draft",
      triggerMessageId: NORMALIZER_IDS.message,
    },
    version: 1,
  };
}

export function draftPatchNode(
  nodeKey: string,
  fieldPath: AgentBuilderDraftPatchFieldPath,
  value: null | string | string[],
  operation: AgentBuilderPlanNode["operation"] = "update",
): AgentBuilderPlanNode {
  return {
    actions: [],
    draftPatch: { fieldPath, value },
    fieldPath,
    kind: "draft_patch",
    nodeKey,
    operation,
    requiresConfirmation: false,
    status: "pending",
    summary: `Update ${fieldPath}.`,
    targetType: "draft",
  };
}

export function plannerContextWithBoundEnvironment(): AgentBuilderPlannerContext {
  const context = plannerContext();
  const currentEnvironment = {
    bindingState: "bound" as const,
    hash: "linear_env_hash",
    id: NORMALIZER_IDS.environmentLinear,
    kind: "environment" as const,
    name: "Linear limited 环境",
  };
  const systemDefaultEnvironment = {
    bindingState: "not_bound" as const,
    hash: "system_env_hash",
    id: NORMALIZER_IDS.environmentSystemDefault,
    kind: "environment" as const,
    name: "System Default",
  };

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        environments: [currentEnvironment, systemDefaultEnvironment],
      },
      draftBindings: {
        ...context.assets.draftBindings,
        environmentId: currentEnvironment.id,
      },
    },
    draft: {
      ...context.draft,
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: claude-agent-sdk",
        "  provider: anthropic",
        "  model: claude-sonnet-4-5",
        "prompt: Old prompt.",
        "environment:",
        `  environmentId: ${NORMALIZER_IDS.environmentLinear}`,
        "assets:",
        "  skills: []",
        "  mcpServers: []",
      ].join("\n"),
    },
  };
}

export function plannerContextWithMissingModelSelection(): AgentBuilderPlannerContext {
  const context = plannerContext();

  return {
    ...context,
    draft: {
      ...context.draft,
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: openai-runtime",
        '  provider: ""',
        '  model: ""',
        "prompt: Old prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills: []",
        "  mcpServers: []",
      ].join("\n"),
    },
  };
}

export function plannerContextWithUnsupportedRuntime(): AgentBuilderPlannerContext {
  const context = plannerContext();

  return {
    ...context,
    draft: {
      ...context.draft,
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: legacy-runtime",
        "  provider: anthropic",
        "  model: claude-sonnet-4-5",
        "prompt: Old prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills: []",
        "  mcpServers: []",
      ].join("\n"),
    },
  };
}

export function plannerContextWithVisibleSkills(
  existingSkillIds: SkillId[],
): AgentBuilderPlannerContext {
  const context = plannerContext();
  const visibleSkillIds = [
    ...existingSkillIds,
    ...Array.from({ length: 240 }, (_, index) => normalizerSkillId(index)),
  ];
  const existingSkillIdSet = new Set(existingSkillIds);

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        skills: visibleSkillIds.map((id) => ({
          bindingState: existingSkillIdSet.has(id) ? ("bound" as const) : ("not_bound" as const),
          hash: `${id}_hash`,
          id,
          kind: "skill" as const,
          name: `Skill ${id}`,
        })),
      },
      draftBindings: {
        ...context.assets.draftBindings,
        skillIds: existingSkillIds,
      },
    },
    draft: {
      ...context.draft,
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: claude-agent-sdk",
        "  provider: anthropic",
        "  model: claude-sonnet-4-5",
        "prompt: Old prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills:",
        ...existingSkillIds.flatMap((id) => [`    - id: ${id}`, `      name: Skill ${id}`]),
        "  mcpServers: []",
      ].join("\n"),
    },
  };
}

export function plannerContextWithVisibleMcpServers(
  existingMcpServerIds: McpServerId[],
): AgentBuilderPlannerContext {
  const context = plannerContext();
  const visibleMcpServerIds = [NORMALIZER_IDS.mcpNeedsAuth, ...existingMcpServerIds];
  const existingMcpServerIdSet = new Set(existingMcpServerIds);

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        mcpServers: visibleMcpServerIds.map((id) => ({
          bindingState: existingMcpServerIdSet.has(id)
            ? ("bound" as const)
            : ("not_bound" as const),
          hash: `${id}_hash`,
          id,
          kind: "mcp_server" as const,
          name: `MCP ${id}`,
        })),
      },
      draftBindings: {
        ...context.assets.draftBindings,
        mcpServerIds: existingMcpServerIds,
      },
    },
    draft: {
      ...context.draft,
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Old Agent",
        "  description: Old description.",
        "runtime:",
        "  id: claude-agent-sdk",
        "  provider: anthropic",
        "  model: claude-sonnet-4-5",
        "prompt: Old prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills: []",
        "  mcpServers:",
        ...existingMcpServerIds.flatMap((id) => [`    - id: ${id}`, `      name: MCP ${id}`]),
      ].join("\n"),
    },
  };
}

export function plannerContextWithVisibleSkillIndex(input: {
  readonly draftSkillLines: readonly string[];
  readonly visibleBoundSkillIds: readonly SkillId[];
}): AgentBuilderPlannerContext {
  const context = plannerContext();

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        skills: input.visibleBoundSkillIds.map((id) => ({
          bindingState: "bound" as const,
          hash: `${id}_hash`,
          id,
          kind: "skill" as const,
          name: `Skill ${id}`,
        })),
      },
      draftBindings: {
        ...context.assets.draftBindings,
        skillIds: [...input.visibleBoundSkillIds],
      },
    },
    draft: {
      ...context.draft,
      yaml: defaultDraftYaml(["  skills:", ...input.draftSkillLines, "  mcpServers: []"]),
    },
  };
}
