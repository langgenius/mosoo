import { describe, expect, test } from "bun:test";

import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

import {
  parseAgentBuilderMessageId,
  parseAgentBuilderPlannerRunId,
  parseAgentBuilderThreadId,
  parseAgentId,
  parseMcpServerId,
  parseOrganizationId,
} from "../src/modules/agent-builder/application/agent-builder-ids";
import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createPrepareDraftPatchTool } from "../src/modules/agent-builder/application/tools/prepare-draft-patch.tool";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const PREPARE_DRAFT_PATCH_IDS = {
  agent: parseAgentId("01J00000000000000000000101"),
  mcpNeedsAuth: parseMcpServerId("01J00000000000000000000102"),
  message: parseAgentBuilderMessageId("01J00000000000000000000103"),
  organization: parseOrganizationId("01J00000000000000000000104"),
  plannerRun: parseAgentBuilderPlannerRunId("01J00000000000000000000105"),
  thread: parseAgentBuilderThreadId("01J00000000000000000000106"),
} as const;

function plannerContext(): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: PREPARE_DRAFT_PATCH_IDS.agent,
      kind: "pet",
      organizationId: PREPARE_DRAFT_PATCH_IDS.organization,
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
        mcpServers: [
          {
            bindingState: "not_bound",
            hash: "mcp_hash",
            id: PREPARE_DRAFT_PATCH_IDS.mcpNeedsAuth,
            kind: "mcp_server",
            name: "Needs Auth MCP",
          },
        ],
        selectedSpaceFiles: [],
        skills: [],
        spaces: [],
      },
      draftBindings: {
        agentsFileId: null,
        channelIds: [],
        environmentId: null,
        mcpServerIds: [],
        parseError: null,
        parseStatus: "parsed",
        skillIds: [],
        spaceIds: [],
      },
      observedAt: "2026-05-20T00:00:00.000Z",
      snapshotHash: "asset_hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "blocked"],
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
        "  agentsFileId: null",
        "  skills: []",
        "  mcpServers: []",
        "  spaces: []",
      ].join("\n"),
    },
    historicalOpenNodes: [],
    plannerRunId: PREPARE_DRAFT_PATCH_IDS.plannerRun,
    readiness: {
      checkedAt: "2026-05-20T00:00:00.000Z",
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
    threadId: PREPARE_DRAFT_PATCH_IDS.thread,
    turn: {
      inputKind: "user_message",
      inputText: "update draft",
      triggerMessageId: PREPARE_DRAFT_PATCH_IDS.message,
    },
    version: 1,
  };
}

function createRuntime(context = plannerContext()) {
  return createAgentBuilderToolRuntime({
    tools: [
      createPrepareDraftPatchTool({
        actorAccountId: "01J00000000000000000000051",
        bindings: { DB: {} as D1Database } as ApiBindings,
        context,
      }),
    ],
  });
}

function outputNodes(output: AgentBuilderToolPayload | null): AgentBuilderPlanNode[] {
  const nodes = output?.["nodes"];

  if (!Array.isArray(nodes)) {
    throw new Error("Expected prepare_draft_patch output nodes.");
  }

  return nodes as AgentBuilderPlanNode[];
}

function outputPatches(output: AgentBuilderToolPayload | null): AgentBuilderToolPayload[] {
  const patches = output?.["patches"];

  if (!Array.isArray(patches)) {
    throw new Error("Expected prepare_draft_patch output patches.");
  }

  return patches as AgentBuilderToolPayload[];
}

describe("prepare_draft_patch tool", () => {
  test("creates normalized Draft patch nodes with base metadata", async () => {
    const result = await createRuntime().execute({
      input: {
        changes: [
          {
            fieldPath: "name",
            value: "Updated Agent",
          },
          {
            fieldPath: "prompt",
            value: "Help support teams triage customer issues.",
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      appliedCount: 2,
      blockedCount: 0,
      itemCount: 2,
      mode: "draft_patch",
      status: "ready",
    });
    expect(outputPatches(result.output)).toMatchObject([
      {
        autoApply: true,
        baseDraftRevision: "draft_hash",
        baseValue: "Old Agent",
        fieldPath: "name",
        sectionId: "basics",
        value: "Updated Agent",
      },
      {
        autoApply: true,
        baseDraftRevision: "draft_hash",
        baseValue: "Old prompt.",
        fieldPath: "prompt",
        sectionId: "basics",
        value: "Help support teams triage customer issues.",
      },
    ]);
  });

  test("resolves visible asset references before returning patch nodes", async () => {
    const result = await createRuntime().execute({
      input: {
        changes: [
          {
            fieldPath: "mcpServerIds",
            value: [PREPARE_DRAFT_PATCH_IDS.mcpNeedsAuth],
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });

    expect(result.output).toMatchObject({
      appliedCount: 1,
      blockedCount: 0,
      status: "ready",
    });
    expect(outputPatches(result.output)[0]).toMatchObject({
      baseValue: [],
      fieldPath: "mcpServerIds",
      resolvedReferences: [
        {
          id: PREPARE_DRAFT_PATCH_IDS.mcpNeedsAuth,
          name: "Needs Auth MCP",
          targetType: "mcp_server",
        },
      ],
      sectionId: "integrations",
      value: [PREPARE_DRAFT_PATCH_IDS.mcpNeedsAuth],
    });
  });

  test("normalizes common Draft YAML field path aliases from generated workflow code", async () => {
    const result = await createRuntime().execute({
      input: {
        changes: [
          {
            fieldPath: " identity.name ",
            value: "Support Agent",
          },
          {
            fieldPath: "identity.description",
            operation: " update ",
            value: "Handles support requests.",
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });

    expect(result.status).toBe("completed");
    expect(outputPatches(result.output)).toMatchObject([
      {
        fieldPath: "name",
        value: "Support Agent",
      },
      {
        fieldPath: "description",
        value: "Handles support requests.",
      },
    ]);
  });

  test("blocks non-visible asset ids instead of returning an applied patch", async () => {
    const result = await createRuntime().execute({
      input: {
        changes: [
          {
            fieldPath: "skillIds",
            value: ["skill_fake"],
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });

    expect(result.output).toMatchObject({
      appliedCount: 0,
      blockedCount: 1,
      status: "blocked",
    });
    expect(outputPatches(result.output)).toEqual([]);
    expect(outputNodes(result.output)[0]?.status).toBe("blocked");
    expect(outputNodes(result.output)[0]?.summary).toContain("non-visible asset IDs");
  });

  test("fails malformed tool input without writing a patch", async () => {
    await expect(
      createRuntime().execute({
        input: {
          changes: [
            {
              fieldPath: "secretIds",
              value: ["secret-prod"],
            },
          ],
        },
        toolId: "prepare_draft_patch",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("fieldPath"),
      output: null,
      status: "failed",
      toolId: "prepare_draft_patch",
    });
  });
});
