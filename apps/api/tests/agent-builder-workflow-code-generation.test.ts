import { describe, expect, test } from "bun:test";

import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";

import {
  generateAgentBuilderAssemblyWorkflowCodeWithRequester,
  validateAgentBuilderAssemblyWorkflowCode,
  validateAgentBuilderAssemblyWorkflowPlan,
} from "../src/modules/agent-builder/application/builder-workflow-code-generator.service";
import type {
  AgentBuilderWorkflowCodeGenerationRequestBody,
  AgentBuilderWorkflowPlannerCodePlan,
} from "../src/modules/agent-builder/application/builder-workflow-code-generator.service";

const VALID_FIRST_DRAFT_CODE = [
  "async () => {",
  "  await builder.get_draft_snapshot({});",
  "  const prepared = await builder.prepare_draft_patch({",
  "    changes: [",
  '      { fieldPath: "name", value: "客服工单 Agent" },',
  '      { fieldPath: "description", value: "整理客服工单。" },',
  '      { fieldPath: "prompt", value: "帮助客服处理工单。" }',
  "    ]",
  "  });",
  "  await builder.dry_run_draft_patch({ nodes: prepared.nodes });",
  '  return { mode: "starter_pack", items: [{ action: { type: "draft_patch" } }] };',
  "}",
].join("\n");

const NAME_ONLY_WORKFLOW_CODE = [
  "async () => {",
  "  await builder.get_draft_snapshot({});",
  "  const prepared = await builder.prepare_draft_patch({",
  "    changes: [",
  '      { fieldPath: "name", nodeKey: "first_draft_name", value: "天气预报小助手" }',
  "    ]",
  "  });",
  "  await builder.dry_run_draft_patch({ nodes: prepared.nodes });",
  '  return { mode: "starter_pack", items: [{ action: { type: "draft_patch" } }] };',
  "}",
].join("\n");

function workflowCodePayload(
  code: string,
  overrides: Partial<Omit<AgentBuilderWorkflowPlannerCodePlan, "code">> = {},
) {
  const plan: AgentBuilderWorkflowPlannerCodePlan = {
    code,
    intentClass: "first_draft_agent_goal",
    sourceMode: "draft_patch",
    toolSequence: ["get_draft_snapshot", "prepare_draft_patch", "dry_run_draft_patch"],
    ...overrides,
  };

  return {
    output_text: JSON.stringify(plan),
  };
}

function plannerContext(inputText = "帮我做一个客服工单 Agent"): AgentBuilderPlannerContext {
  const emptyChanges = { added: [], removed: [], updated: [] };

  return {
    agent: {
      agentId: "agent_1",
      kind: "pet",
      organizationId: "org_1",
      status: "draft",
    },
    assets: {
      changesSinceLastTurn: {
        channels: emptyChanges,
        environments: emptyChanges,
        mcpServers: emptyChanges,
        selectedSpaceFiles: emptyChanges,
        skills: emptyChanges,
        spaces: emptyChanges,
      },
      currentIndex: {
        channels: [],
        environments: [],
        mcpServers: [],
        selectedSpaceFiles: [],
        skills: [
          {
            bindingState: "not_bound",
            hash: "skill_hash",
            id: "skill_linear",
            kind: "skill",
            name: "Linear Triage",
          },
        ],
        spaces: [
          {
            bindingState: "not_bound",
            hash: "space_hash",
            id: "space_support",
            kind: "space",
            name: "Support KB",
          },
        ],
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
      observedAt: "2026-05-25T00:00:00.000Z",
      snapshotHash: "assets_hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "blocked"],
      forbiddenWrites: ["secret_plaintext", "publish_state"],
      requiresLlmPlanner: true,
    },
    conversation: { recentMessages: [] },
    draft: {
      revision: "draft_rev_1",
      yaml: "version: 1\nkind: pet\nprompt: Help the user.",
    },
    historicalOpenNodes: [],
    plannerRunId: "planner_run_1",
    readiness: {
      checkedAt: "2026-05-25T00:00:00.000Z",
      errorCount: 0,
      issues: [],
      ready: true,
      warningCount: 0,
    },
    systemAgent: {
      credentialSource: "provider_database",
      model: {
        modelId: "gpt-5.1",
        provider: "openai",
      },
    },
    threadId: "thread_1",
    turn: {
      inputKind: "user_message",
      inputText,
      triggerMessageId: "message_1",
    },
    version: 1,
  };
}

describe("Agent Builder workflow code generation", () => {
  test("passes a structured request to the requester and parses generated code", async () => {
    let capturedRequest: AgentBuilderWorkflowCodeGenerationRequestBody | null = null;
    const code = await generateAgentBuilderAssemblyWorkflowCodeWithRequester({
      context: plannerContext(),
      model: "gpt-5.1",
      requester: async (requestBody) => {
        capturedRequest = requestBody;

        return workflowCodePayload(VALID_FIRST_DRAFT_CODE);
      },
    });

    expect(validateAgentBuilderAssemblyWorkflowCode(code, plannerContext())).toEqual([]);
    if (capturedRequest === null) {
      throw new Error("Expected workflow code requester to receive a request body.");
    }

    expect(capturedRequest.model).toBe("gpt-5.1");
    expect(capturedRequest.input.length).toBeGreaterThan(0);
    expect(capturedRequest.text.format.schema.required).toEqual(
      expect.arrayContaining(["intentClass", "sourceMode", "toolSequence", "code"]),
    );
    expect(capturedRequest.text.format.schema.properties.code).toMatchObject({
      type: "string",
    });
  });

  test("rejects generated code that calls excluded create or commit tools", async () => {
    const unsafeCode = [
      "async () => {",
      '  await builder.prepare_create_space({ name: "Support KB" });',
      '  return { mode: "starter_pack" };',
      "}",
    ].join("\n");

    expect(validateAgentBuilderAssemblyWorkflowCode(unsafeCode)).toEqual(
      expect.arrayContaining([expect.stringContaining("prepare_create_space")]),
    );
    await expect(
      generateAgentBuilderAssemblyWorkflowCodeWithRequester({
        context: plannerContext(),
        model: "gpt-5.1",
        requester: async () =>
          workflowCodePayload(unsafeCode, {
            intentClass: "unsupported_or_blocked",
            sourceMode: "blocked",
            toolSequence: ["prepare_create_space"],
          }),
      }),
    ).rejects.toThrow("prepare_create_space");
  });

  test("rejects and regenerates under-planned first-draft Agent goal code before execution", async () => {
    const context = plannerContext("我要一个天气预报小助手");
    const capturedRequests: AgentBuilderWorkflowCodeGenerationRequestBody[] = [];
    const code = await generateAgentBuilderAssemblyWorkflowCodeWithRequester({
      context,
      model: "gpt-5.1",
      requester: async (requestBody) => {
        capturedRequests.push(requestBody);

        return workflowCodePayload(
          capturedRequests.length === 1 ? NAME_ONLY_WORKFLOW_CODE : VALID_FIRST_DRAFT_CODE,
        );
      },
    });

    expect(validateAgentBuilderAssemblyWorkflowCode(code, context)).toEqual([]);
    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[1]?.input.length).toBeGreaterThan(
      capturedRequests[0]?.input.length ?? 0,
    );
    expect(capturedRequests[1]?.input).not.toEqual(capturedRequests[0]?.input);
  });

  test("validates first-draft Agent goals as coherent tool sequences", () => {
    expect(
      validateAgentBuilderAssemblyWorkflowCode(
        NAME_ONLY_WORKFLOW_CODE,
        plannerContext("我要一个天气预报小助手"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("description"),
        expect.stringContaining("prompt"),
      ]),
    );

    expect(
      validateAgentBuilderAssemblyWorkflowCode(
        NAME_ONLY_WORKFLOW_CODE,
        plannerContext("只把名字改成天气预报小助手"),
      ),
    ).toEqual([]);
  });

  test("validates planner intent metadata against generated tool calls", () => {
    const context = plannerContext("我要一个天气预报小助手");

    expect(
      validateAgentBuilderAssemblyWorkflowPlan(
        {
          code: VALID_FIRST_DRAFT_CODE,
          intentClass: "draft_field_edit",
          sourceMode: "draft_patch",
          toolSequence: ["get_draft_snapshot", "prepare_draft_patch", "dry_run_draft_patch"],
        },
        context,
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining("first_draft_agent_goal")]));

    expect(
      validateAgentBuilderAssemblyWorkflowPlan(
        {
          code: VALID_FIRST_DRAFT_CODE,
          intentClass: "first_draft_agent_goal",
          sourceMode: "plain_text",
          toolSequence: ["get_draft_snapshot", "dry_run_draft_patch"],
        },
        context,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prepare_draft_patch"),
        expect.stringContaining("sourceMode draft_patch"),
      ]),
    );
  });

  test("validates bind-existing-asset plans before workflow execution", () => {
    const bindWithoutPatchCode = [
      "async () => {",
      '  await builder.resolve_asset_reference({ assetType: "space", name: "Support KB", bindingState: ["not_bound"] });',
      '  return { mode: "starter_pack" };',
      "}",
    ].join("\n");

    expect(
      validateAgentBuilderAssemblyWorkflowPlan({
        code: bindWithoutPatchCode,
        intentClass: "bind_existing_asset",
        sourceMode: "draft_patch",
        toolSequence: ["resolve_asset_reference"],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prepare_bind_*_patch"),
        expect.stringContaining("dry_run_draft_patch"),
      ]),
    );
  });

  test("rejects malformed code generation responses before sandbox execution", async () => {
    await expect(
      generateAgentBuilderAssemblyWorkflowCodeWithRequester({
        context: plannerContext(),
        model: "gpt-5.1",
        requester: async () => ({
          output_text: "not-json",
        }),
      }),
    ).rejects.toThrow("invalid JSON");

    await expect(
      generateAgentBuilderAssemblyWorkflowCodeWithRequester({
        context: plannerContext(),
        model: "gpt-5.1",
        requester: async () => ({
          output_text: JSON.stringify({ code: 'async () => ({ mode: "plain_text" })' }),
        }),
      }),
    ).rejects.toThrow("valid intentClass");

    await expect(
      generateAgentBuilderAssemblyWorkflowCodeWithRequester({
        context: plannerContext(),
        model: "gpt-5.1",
        requester: async () =>
          workflowCodePayload('async () => ({ mode: "plain_text" })', {
            intentClass: "ordinary_question",
            sourceMode: "plain_text",
            toolSequence: [],
          }),
      }),
    ).rejects.toThrow("Starter Pack");
  });
});
