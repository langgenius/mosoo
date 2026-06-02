import { describe, expect, test } from "bun:test";

import type {
  AgentBuilderPlannerContext,
  AgentBuilderReadinessContext,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createDryRunDraftPatchTool } from "../src/modules/agent-builder/application/tools/dry-run-draft-patch.tool";
import { createPrepareDraftPatchTool } from "../src/modules/agent-builder/application/tools/prepare-draft-patch.tool";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const viewer: AuthenticatedViewer = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
};

function readyReadiness(): AgentBuilderReadinessContext {
  return {
    checkedAt: "2026-05-20T00:00:00.000Z",
    errorCount: 0,
    issues: [],
    ready: true,
    warningCount: 0,
  };
}

function plannerContext(): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: "agent_1",
      kind: "pet",
      organizationId: "org_1",
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
        "  id: openai-runtime",
        "  provider: openai",
        "  model: gpt-5.4",
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
    plannerRunId: "planner_run_1",
    readiness: readyReadiness(),
    systemAgent: {
      credentialSource: "provider_database",
      model: {
        modelId: "o3-mini",
        provider: "openai",
      },
    },
    threadId: "thread_1",
    turn: {
      inputKind: "user_message",
      inputText: "update draft",
      triggerMessageId: "message_1",
    },
    version: 1,
  };
}

function createPrepareRuntime(context = plannerContext()) {
  return createAgentBuilderToolRuntime({
    tools: [
      createPrepareDraftPatchTool({
        actorAccountId: viewer.id,
        bindings: { DB: {} as D1Database } as ApiBindings,
        context,
      }),
    ],
  });
}

function createDryRunRuntime(
  context = plannerContext(),
  readiness: AgentBuilderReadinessContext = readyReadiness(),
) {
  return createAgentBuilderToolRuntime({
    tools: [
      createDryRunDraftPatchTool({
        bindings: { DB: {} as D1Database } as ApiBindings,
        collectReadiness: async () => readiness,
        context,
        viewer,
      }),
    ],
  });
}

function payloadObject(
  output: AgentBuilderToolPayload | null,
  fieldName: string,
): AgentBuilderToolPayload {
  const value = output?.[fieldName];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${fieldName} payload object.`);
  }

  return value as AgentBuilderToolPayload;
}

describe("dry_run_draft_patch tool", () => {
  test("simulates prepared patch nodes against the current Draft YAML", async () => {
    const context = plannerContext();
    const prepared = await createPrepareRuntime(context).execute({
      input: {
        changes: [
          {
            fieldPath: "prompt",
            value: "New prompt.",
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });
    const dryRun = await createDryRunRuntime(context).execute({
      input: {
        includeYaml: true,
        nodes: prepared.output?.["nodes"],
      },
      toolId: "dry_run_draft_patch",
    });

    expect(dryRun.status).toBe("completed");
    expect(dryRun.output).toMatchObject({
      appliedPatchCount: 1,
      changedFields: ["prompt"],
      mode: "draft_patch",
      newRepairableErrorCount: 0,
      status: "passed",
    });
    expect(payloadObject(dryRun.output, "proposedDraft")).toMatchObject({
      prompt: "New prompt.",
    });
    expect(dryRun.output?.["proposedDraftYaml"]).toContain("New prompt.");
  });

  test("blocks when dry-run readiness introduces new repairable errors", async () => {
    const readiness: AgentBuilderReadinessContext = {
      checkedAt: "2026-05-20T00:01:00.000Z",
      errorCount: 1,
      issues: [
        {
          code: "agent_builder.runtime.missing",
          message: "Draft runtime is required.",
          severity: "error",
        },
      ],
      ready: false,
      warningCount: 0,
    };
    const dryRun = await createDryRunRuntime(plannerContext(), readiness).execute({
      input: {
        patches: [
          {
            autoApply: true,
            fieldPath: "runtimeId",
            value: "",
          },
        ],
      },
      toolId: "dry_run_draft_patch",
    });

    expect(dryRun.output).toMatchObject({
      appliedPatchCount: 1,
      changedFields: ["runtimeId"],
      newRepairableErrorCount: 1,
      status: "blocked",
    });
    expect(dryRun.output?.["newRepairableErrors"]).toEqual([
      {
        code: "agent_builder.runtime.missing",
        message: "Draft runtime is required.",
        severity: "error",
      },
    ]);
  });

  test("accepts common prepared patch wrapper payloads from generated workflow code", async () => {
    const context = plannerContext();
    const prepared = await createPrepareRuntime(context).execute({
      input: {
        changes: [
          {
            fieldPath: "prompt",
            value: "Wrapped prompt.",
          },
        ],
      },
      toolId: "prepare_draft_patch",
    });
    const dryRun = await createDryRunRuntime(context).execute({
      input: {
        prepareResult: prepared.output,
      },
      toolId: "dry_run_draft_patch",
    });

    expect(dryRun.status).toBe("completed");
    expect(dryRun.output).toMatchObject({
      appliedPatchCount: 1,
      changedFields: ["prompt"],
      status: "passed",
    });
  });

  test("fails malformed nodes through the tool runtime", async () => {
    await expect(
      createDryRunRuntime().execute({
        input: {
          nodes: [{ nope: true }],
        },
        toolId: "dry_run_draft_patch",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("nodes"),
      output: null,
      status: "failed",
      toolId: "dry_run_draft_patch",
    });
  });
});
