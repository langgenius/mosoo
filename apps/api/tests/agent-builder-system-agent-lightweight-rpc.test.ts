import { describe, expect, test } from "bun:test";

import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";

import { executeAgentBuilderControlPlaneAction } from "../src/modules/agent-builder/application/agent-builder-control-plane-action.service";
import { createAgentBuilderMessageId } from "../src/modules/agent-builder/application/agent-builder-ids";
import { createDefaultAgentBuilderLightweightPlanner } from "../src/modules/agent-builder/application/agent-builder-lightweight-planner-policy.service";
import { submitAgentBuilderSystemAgentMessage } from "../src/modules/agent-builder/application/agent-builder-system-agent-rpc.service";
import {
  createAgentBuilderSystemAgentSubmitRuntime,
  selectAgentBuilderSystemAgentPlannerRoute,
} from "../src/modules/agent-builder/application/agent-builder-system-agent-runtime.service";
import {
  ensureAgentBuilderThread,
  listAgentBuilderMessages,
} from "../src/modules/agent-builder/application/agent-builder-thread.service";
import { listAgentSessions } from "../src/modules/sessions/application/agent-session-query.service";
import {
  NORMALIZER_IDS,
  normalizerSkillId,
  plannerContext,
  plannerContextWithBoundEnvironment,
} from "./agent-builder-draft-patch-normalizer-fixtures";
import {
  createAgentBuilderApiFixture,
  insertAgentBuilderVendorCredential,
} from "./helpers/agent-builder-api-fixture";
import type { AgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";
import { readFetchUrl } from "./helpers/fetch-request-url";

type ControlPlaneActionInput = Parameters<typeof executeAgentBuilderControlPlaneAction>[2];

const DRAFT_YAML = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Slack Support Bot",
  "  description: Triage customer support messages in Slack.",
  "runtime:",
  "  id: claude-agent-sdk",
  "  provider: anthropic",
  "  model: claude-sonnet-4-5",
  "prompt: Triage Slack support messages and write concise replies.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
  "  spaces: []",
].join("\n");

const DRAFT_YAML_WITH_SKIPPED_ENVIRONMENT = [
  ...DRAFT_YAML.split("\n"),
  "builder:",
  "  componentDecisions:",
  "    environment: skipped",
].join("\n");

function withPendingEnvironmentQuestion(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerContext {
  return {
    ...context,
    historicalOpenNodes: [
      {
        actions: [],
        askUser: {
          allowCustomText: true,
          allowSkip: true,
          mode: "single_select" as const,
          options: [],
          prompt: "Would you like to reuse an existing Environment or create a new one?",
          submitLabel: "Continue",
        },
        kind: "question" as const,
        nodeKey: "ask_environment",
        operation: "ask" as const,
        requiresConfirmation: false,
        status: "pending" as const,
        summary: "Ask the user how to configure the Agent Environment.",
        targetType: "environment" as const,
      },
    ],
  };
}

function withPendingComponentQuestion(
  context: AgentBuilderPlannerContext,
  input: {
    readonly mode: "multi_select" | "single_select";
    readonly nodeKey: string;
    readonly targetType: "mcp" | "skill" | "space";
  },
): AgentBuilderPlannerContext {
  return {
    ...context,
    historicalOpenNodes: [
      {
        actions: [],
        askUser: {
          allowCustomText: true,
          allowSkip: true,
          mode: input.mode,
          options: [],
          prompt: "Choose optional Agent components.",
          submitLabel: "Continue",
        },
        kind: "question" as const,
        nodeKey: input.nodeKey,
        operation: "ask" as const,
        requiresConfirmation: false,
        status: "pending" as const,
        summary: "Ask the user how to configure optional Agent components.",
        targetType: input.targetType,
      },
    ],
  };
}

function plannerContextWithOptionalComponentAssets(): AgentBuilderPlannerContext {
  const context = plannerContextWithBoundEnvironment();
  const skillId = normalizerSkillId(1);

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        mcpServers: [
          {
            bindingState: "not_bound",
            hash: "slack_mcp_hash",
            id: NORMALIZER_IDS.mcpNeedsAuth,
            kind: "mcp_server",
            name: "Slack MCP",
          },
        ],
        skills: [
          {
            bindingState: "not_bound",
            hash: "pdf_skill_hash",
            id: skillId,
            kind: "skill",
            name: "PDF",
          },
        ],
        spaces: [
          {
            bindingState: "not_bound",
            hash: "support_space_hash",
            id: NORMALIZER_IDS.spaceAvailable,
            kind: "space",
            name: "Support KB",
          },
        ],
      },
    },
  };
}

async function login(fixture: AgentBuilderApiFixture) {
  await fixture.client.loginAsMosooAiTestAccount();
  const viewer = await fixture.client.readAuthenticatedViewerFromSession();

  if (viewer === null) {
    throw new Error("Expected Agent Builder test viewer session.");
  }

  return viewer;
}

function createDeterministicAgentBuilderRuntime(
  fixture: AgentBuilderApiFixture,
  viewer: Awaited<ReturnType<typeof login>>,
) {
  return createAgentBuilderSystemAgentSubmitRuntime({
    bindings: fixture.bindings,
    planner: createDefaultAgentBuilderLightweightPlanner(),
    viewer,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readJsonObjectBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected JSON string request body.");
  }

  const parsed: unknown = JSON.parse(body);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object request body.");
  }

  return parsed;
}

async function executeFixtureControlPlaneAction(
  fixture: AgentBuilderApiFixture,
  viewer: AgentBuilderApiFixture["viewer"],
  input: Omit<ControlPlaneActionInput, "appId">,
) {
  return executeAgentBuilderControlPlaneAction(fixture.bindings, viewer, {
    ...input,
    appId: fixture.ids.appId,
  });
}

async function insertPreviewSession(
  fixture: AgentBuilderApiFixture,
  input: {
    readonly archivedAt?: number | null;
    readonly attributedUserId?: string | null;
    readonly createdAt: number;
    readonly creatorAccountId: string;
    readonly id: string;
    readonly lastMessageAt: number | null;
    readonly messageSeqCursor: number;
    readonly updatedAt: number;
  },
): Promise<void> {
  await fixture.bindings.DB.prepare(
    `INSERT INTO session (
      agent_id,
      archived_at,
      attributed_user_id,
      created_at,
      creator_account_id,
      id,
      kind,
      last_message_at,
      message_seq_cursor,
      metadata_json,
      model,
      organization_id,
      app_id,
      provider,
      renamed,
      runtime_id,
      status,
      title,
      type,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      fixture.ids.agentId,
      input.archivedAt ?? null,
      input.attributedUserId ?? null,
      input.createdAt,
      input.creatorAccountId,
      input.id,
      "pet",
      input.lastMessageAt,
      input.messageSeqCursor,
      "{}",
      "claude-sonnet-4-5",
      fixture.ids.organizationId,
      fixture.ids.appId,
      "anthropic",
      0,
      "cloudflare-agents-sdk",
      "IDLE",
      null,
      "preview",
      input.updatedAt,
    )
    .run();
}

describe("Agent Builder System Agent lightweight RPC", () => {
  test("emits an open-preview action when required Builder fields are complete", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const output = await planner.plan({
      context: plannerContextWithBoundEnvironment(),
    });

    expect(output.mode).toBe("action");
    expect(output.nodes[0]).toMatchObject({
      kind: "action",
      nodeKey: "show_next_action:open_preview",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
    expect(output.nodes[0]?.actions[0]).toEqual({
      actionKey: "open_preview",
      label: "Test in Chat",
      style: "primary",
    });
  });

  test("keeps Agent API Endpoints in refactor mode instead of Quickstart steps", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContext();
    const output = await planner.plan({
      context: {
        ...context,
        agent: {
          ...context.agent,
          status: "published",
        },
        turn: {
          ...context.turn,
          inputText: "用户反馈这个已发布 Agent 有 bug，帮我调整配置",
        },
      },
    });

    expect(output.mode).toBe("action");
    expect(output.nodes[0]).toMatchObject({
      actions: [
        {
          actionKey: "apply_agent_config",
          label: "Apply changes",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:apply_agent_config",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
    expect(output.intentSummary).toBe("Continue lightweight Agent Manifest refactor.");
  });

  test("asks for optional Skill selection when the user requests Skills in Step 2", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const output = await planner.plan({
      context: {
        ...context,
        turn: {
          ...context.turn,
          inputText: "给这个 Agent 添加 PDF skill",
        },
      },
    });

    expect(output.mode).toBe("question");
    expect(output.nodes[0]).toMatchObject({
      kind: "question",
      nodeKey: "ask_skills",
      operation: "ask",
      status: "pending",
      targetType: "skill",
    });
    expect(output.nodes[0]?.askUser?.mode).toBe("multi_select");
    expect(output.nodes[0]?.askUser?.allowCustomText).toBe(true);
    expect(output.nodes[0]?.askUser?.allowSkip).toBe(true);
    expect(output.nodes[0]?.askUser?.options[0]).toMatchObject({
      label: "PDF",
      optionKey: `skill:${normalizerSkillId(1)}`,
      value: normalizerSkillId(1),
    });
  });

  test("applies selected optional Skills as a Manifest patch", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const skillId = normalizerSkillId(1);
    const output = await planner.plan({
      context: {
        ...withPendingComponentQuestion(context, {
          mode: "multi_select",
          nodeKey: "ask_skills",
          targetType: "skill",
        }),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "multi_select",
            nodeKey: "ask_skills",
            selectedOptionKeys: [`skill:${skillId}`],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("draft_patch");
    expect(output.nodes[0]).toMatchObject({
      draftPatch: {
        fieldPath: "skillIds",
        value: [skillId],
      },
      kind: "draft_patch",
      nodeKey: "patch_skills",
      operation: "bind",
      status: "pending",
      targetType: "draft",
    });
  });

  test("applies selected optional Spaces as a Manifest patch", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const output = await planner.plan({
      context: {
        ...withPendingComponentQuestion(context, {
          mode: "multi_select",
          nodeKey: "ask_spaces",
          targetType: "space",
        }),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "multi_select",
            nodeKey: "ask_spaces",
            selectedOptionKeys: [`space:${NORMALIZER_IDS.spaceAvailable}`],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("draft_patch");
    expect(output.nodes[0]).toMatchObject({
      draftPatch: {
        fieldPath: "spaceIds",
        value: [NORMALIZER_IDS.spaceAvailable],
      },
      kind: "draft_patch",
      nodeKey: "patch_spaces",
      operation: "bind",
      status: "pending",
      targetType: "draft",
    });
  });

  test("applies selected optional MCP servers as a Manifest patch", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const output = await planner.plan({
      context: {
        ...withPendingComponentQuestion(context, {
          mode: "multi_select",
          nodeKey: "ask_mcp_servers",
          targetType: "mcp",
        }),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "multi_select",
            nodeKey: "ask_mcp_servers",
            selectedOptionKeys: [`mcp_server:${NORMALIZER_IDS.mcpNeedsAuth}`],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("draft_patch");
    expect(output.nodes[0]).toMatchObject({
      draftPatch: {
        fieldPath: "mcpServerIds",
        value: [NORMALIZER_IDS.mcpNeedsAuth],
      },
      kind: "draft_patch",
      nodeKey: "patch_mcp_servers",
      operation: "bind",
      status: "pending",
      targetType: "draft",
    });
  });

  test("keeps selected optional MCP patch when remote MCP creation is also selected", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const output = await planner.plan({
      context: {
        ...withPendingComponentQuestion(context, {
          mode: "multi_select",
          nodeKey: "ask_mcp_servers",
          targetType: "mcp",
        }),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "multi_select",
            nodeKey: "ask_mcp_servers",
            selectedOptionKeys: [
              `mcp_server:${NORMALIZER_IDS.mcpNeedsAuth}`,
              "action:create_remote_mcp_server",
            ],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("draft_patch");
    expect(output.nodes).toHaveLength(2);
    expect(output.nodes[0]).toMatchObject({
      draftPatch: {
        fieldPath: "mcpServerIds",
        value: [NORMALIZER_IDS.mcpNeedsAuth],
      },
      kind: "draft_patch",
      nodeKey: "patch_mcp_servers",
      operation: "bind",
      status: "pending",
      targetType: "draft",
    });
    expect(output.nodes[1]).toMatchObject({
      actions: [
        {
          actionKey: "create_remote_mcp_server",
          label: "Create remote MCP server",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:create_remote_mcp_server",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
  });

  test("routes optional MCP free-text replies to the remote MCP secure UI action", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithOptionalComponentAssets();
    const output = await planner.plan({
      context: {
        ...withPendingComponentQuestion(context, {
          mode: "multi_select",
          nodeKey: "ask_mcp_servers",
          targetType: "mcp",
        }),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: "Connect Slack over a remote MCP server.",
            mode: "free_text",
            nodeKey: "ask_mcp_servers",
            selectedOptionKeys: [],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("action");
    expect(output.nodes[0]).toMatchObject({
      actions: [
        {
          actionKey: "create_remote_mcp_server",
          label: "Create remote MCP server",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:create_remote_mcp_server",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
  });

  test("submits a lightweight planner turn without legacy execution output", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "帮我检查这个 Slack agent 下一步应该做什么",
      runtime: {
        planner: {
          async plan({ context }) {
            return {
              assistantText: "基础 Agent 已经完整；下一步选择或跳过 Environment。",
              intentSummary: "Guide the user to Step 2 Environment configuration.",
              mode: "plain_text",
              nodes: [],
              plannerRunId: context.plannerRunId,
              version: 1,
            };
          },
        },
      },
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);

    expect(result.terminal).toEqual({
      failureKind: null,
      message: null,
      status: "completed",
    });
    expect(result.state).toEqual({
      draftId: fixture.ids.agentId,
      lastPlannerRunId: assistantMessage?.plannerRunId,
    });
    expect(assistantMessage?.contentText).toBe(
      "基础 Agent 已经完整；下一步选择或跳过 Environment。",
    );

    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );

    expect(plannerOutput?.mode).toBe("plain_text");

    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected lightweight planner run id.");
    }

    const row = await fixture.bindings.DB.prepare(
      "SELECT context_json, output_json, provider, model, tool_trace_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{
        context_json: string;
        model: string;
        output_json: string;
        provider: string;
        tool_trace_json: string | null;
      }>();

    expect(row?.provider).toBe("agent-builder-lightweight");
    expect(row?.model).toBe("deterministic-planner");
    expect(row?.tool_trace_json).toBeNull();
    expect(row?.context_json).toContain("lightweight_control_plane");
    expect(parseAgentBuilderPlannerOutput(JSON.parse(row?.output_json ?? "null"))?.mode).toBe(
      "plain_text",
    );
  });

  test("persists planner run completed_at from the actual planner completion time", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "帮我检查这个 Slack agent 下一步应该做什么",
      runtime: {
        planner: {
          async plan({ context }) {
            await sleep(20);

            return {
              assistantText: "基础 Agent 已经完整；下一步选择或跳过 Environment。",
              intentSummary: "Guide the user to Step 2 Environment configuration.",
              mode: "plain_text",
              nodes: [],
              plannerRunId: context.plannerRunId,
              version: 1,
            };
          },
        },
      },
      threadId: thread.id,
    });
    const plannerRunId = result.messages.at(-1)?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected lightweight planner run id.");
    }

    const row = await fixture.bindings.DB.prepare(
      "SELECT completed_at, context_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{ completed_at: number; context_json: string }>();

    if (row === null) {
      throw new Error("Expected persisted planner run row.");
    }

    expect(JSON.parse(row.context_json)).toMatchObject({
      plannerExecution: {
        completedAt: new Date(row.completed_at).toISOString(),
      },
    });
  });

  test("passes raw Builder input through to the planner", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const rawInput = "name = Docs Helper; goal = answer documentation questions";
    let plannerInputText: string | null = null;
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: rawInput,
      runtime: {
        planner: {
          plan({ context }) {
            plannerInputText = context.turn.inputText;

            return {
              assistantText: "我会按这段需求更新 Agent 草稿。",
              intentSummary: "Use raw Builder input as planning context.",
              mode: "plain_text",
              nodes: [],
              plannerRunId: context.plannerRunId,
              version: 1,
            };
          },
        },
      },
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected lightweight planner run id.");
    }

    const messageRows = await fixture.bindings.DB.prepare(
      "SELECT content_text, role FROM agent_builder_message WHERE planner_run_id = ? ORDER BY seq",
    )
      .bind(plannerRunId)
      .all<{ content_text: string; role: string }>();
    const plannerRunRow = await fixture.bindings.DB.prepare(
      "SELECT context_json, status FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{ context_json: string; status: string }>();

    expect(plannerInputText).toBe(rawInput);
    expect(plannerOutput?.mode).toBe("plain_text");
    expect(plannerRunRow?.status).toBe("completed");
    expect(messageRows.results.find((row) => row.role === "user")?.content_text).toBe(rawInput);
    expect(plannerRunRow?.context_json).toContain(rawInput);
  });

  test("passes raw Draft YAML through to the planner", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const rawDraftYaml = [DRAFT_YAML, "notes:", "  user_goal: docs-helper"].join("\n");
    let plannerDraftYaml: string | null = null;
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: rawDraftYaml,
      inputText: "帮我检查这个 Agent 配置",
      runtime: {
        planner: {
          plan({ context }) {
            plannerDraftYaml = context.draft.yaml;

            return {
              assistantText: "我会按当前草稿继续规划。",
              intentSummary: "Use raw Draft YAML as planning context.",
              mode: "plain_text",
              nodes: [],
              plannerRunId: context.plannerRunId,
              version: 1,
            };
          },
        },
      },
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected lightweight planner run id.");
    }

    const plannerRunRow = await fixture.bindings.DB.prepare(
      "SELECT context_json, output_json, status FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{ context_json: string; output_json: string; status: string }>();

    expect(plannerDraftYaml).toBe(rawDraftYaml);
    expect(plannerOutput?.mode).toBe("plain_text");
    expect(plannerRunRow?.status).toBe("completed");
    expect(plannerRunRow?.context_json).toContain("docs-helper");
  });

  test("returns historical Builder messages and cards by JSON/status contract", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const historicalMessage = '{"requested_agent":"docs helper"}';
    const historicalCardsJson = JSON.stringify({
      assistantText: "safe",
      intentSummary: "safe",
      mode: "action",
      nodes: [
        {
          actions: [],
          kind: "action",
          nodeKey: "show_next_action:create_agent",
          operation: "show",
          requiresConfirmation: false,
          status: "pending",
          summary: "Ready to create the Agent.",
          targetType: "workflow",
        },
      ],
      plannerRunId: "planner_run_historical_cards",
      version: 1,
    });

    await fixture.bindings.DB.prepare(
      `INSERT INTO agent_builder_message (
        cards_json,
        content_text,
        created_at,
        created_by_account_id,
        id,
        input_kind,
        planner_run_id,
        role,
        seq,
        thread_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        null,
        historicalMessage,
        1_001,
        viewer.id,
        createAgentBuilderMessageId(),
        "user_message",
        null,
        "user",
        1,
        thread.id,
      )
      .run();
    await fixture.bindings.DB.prepare(
      `INSERT INTO agent_builder_message (
        cards_json,
        content_text,
        created_at,
        created_by_account_id,
        id,
        input_kind,
        planner_run_id,
        role,
        seq,
        thread_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        historicalCardsJson,
        "safe assistant",
        1_002,
        viewer.id,
        createAgentBuilderMessageId(),
        "assistant_message",
        null,
        "assistant",
        2,
        thread.id,
      )
      .run();

    const messages = await listAgentBuilderMessages(fixture.bindings.DB, viewer, {
      agentId: fixture.ids.agentId,
    });
    const replayJson = JSON.stringify(messages);

    expect(replayJson).toContain("docs helper");
    expect(messages[0]?.contentText).toBe(historicalMessage);
    expect(messages[1]?.contentText).toBe("safe assistant");
    expect(messages[1]?.cardsJson).toBe(historicalCardsJson);
  });

  test("default runtime calls the configured System Agent model provider", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, {
      apiKey: "sk-unit-agent-builder",
      vendorId: "openai",
    });

    const fetchUrls: string[] = [];
    const fetchBodies: Record<string, unknown>[] = [];
    const fetchHeaders: Headers[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      fetchUrls.push(readFetchUrl(url));
      fetchBodies.push(readJsonObjectBody(init?.body));
      fetchHeaders.push(new Headers(init?.headers));

      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                assistantText: "Base Agent fields are ready.",
                intentSummary: "Show the create Agent action.",
                mode: "action",
                nodes: [
                  {
                    actions: [
                      {
                        actionKey: "create_agent",
                        label: "Create this agent",
                        style: "primary",
                      },
                    ],
                    kind: "action",
                    nodeKey: "show_next_action:create_agent",
                    operation: "show",
                    requiresConfirmation: false,
                    status: "pending",
                    summary: "Create the Agent from the current Manifest.",
                    targetType: "workflow",
                  },
                ],
                plannerRunId: "model-generated-run-id",
                version: 1,
              }),
            },
          },
        ],
      });
    };

    try {
      const viewer = await login(fixture);
      const thread = await ensureAgentBuilderThread(
        fixture.bindings.DB,
        viewer,
        fixture.ids.agentId,
      );
      const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-llm-1",
        draftYaml: DRAFT_YAML,
        inputText: "帮我创建 Agent",
        runtime: createAgentBuilderSystemAgentSubmitRuntime({
          bindings: fixture.bindings,
          viewer,
        }),
        threadId: thread.id,
      });
      const assistantMessage = result.messages.at(-1);
      const output = parseAgentBuilderPlannerOutput(
        JSON.parse(assistantMessage?.cardsJson ?? "null"),
      );
      const plannerRunRow = await fixture.bindings.DB.prepare(
        "SELECT model, provider FROM agent_builder_planner_run WHERE id = ?",
      )
        .bind(assistantMessage?.plannerRunId)
        .first<{ model: string; provider: string }>();

      expect(fetchUrls).toEqual(["https://api.openai.com/v1/chat/completions"]);
      expect(fetchHeaders[0]?.get("authorization")).toBe("Bearer sk-unit-agent-builder");
      expect(fetchBodies[0]?.["model"]).toBe("gpt-5.4");
      expect(fetchBodies[0]?.["response_format"]).toMatchObject({
        json_schema: {
          name: "agent_builder_planner_output",
          strict: true,
        },
        type: "json_schema",
      });
      expect(JSON.stringify(fetchBodies[0]?.["response_format"])).toContain("draftPatch");
      expect(JSON.stringify(fetchBodies[0])).toContain("controlPlaneTools");
      expect(JSON.stringify(fetchBodies[0])).toContain("plannerContext");
      expect(output?.mode).toBe("action");
      expect(output?.plannerRunId).toBe(assistantMessage?.plannerRunId);
      expect(output?.nodes[0]?.nodeKey).toBe("show_next_action:create_agent");
      expect(plannerRunRow).toEqual({ model: "gpt-5.4", provider: "openai" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default runtime rewrites non-draft Quickstart actions into refactor apply actions", async () => {
    const quickstartActions = [
      {
        actionKey: "create_agent",
        label: "Create this agent",
      },
      {
        actionKey: "configure_environment",
        label: "Configure environment",
      },
    ] as const;

    for (const quickstartAction of quickstartActions) {
      const fixture = await createAgentBuilderApiFixture();
      await insertAgentBuilderVendorCredential(fixture, {
        apiKey: "sk-unit-agent-builder",
        vendorId: "openai",
      });
      await fixture.bindings.DB.prepare("UPDATE agent SET status = 'published' WHERE id = ?")
        .bind(fixture.ids.agentId)
        .run();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistantText: "Base Agent fields are ready.",
                  intentSummary: "Show a Quickstart action.",
                  mode: "action",
                  nodes: [
                    {
                      actions: [
                        {
                          actionKey: quickstartAction.actionKey,
                          label: quickstartAction.label,
                          style: "primary",
                        },
                      ],
                      kind: "action",
                      nodeKey: `show_next_action:${quickstartAction.actionKey}`,
                      operation: "show",
                      requiresConfirmation: false,
                      status: "pending",
                      summary: "Show a Quickstart action from the current Manifest.",
                      targetType: "workflow",
                    },
                  ],
                  plannerRunId: "model-generated-run-id",
                  version: 1,
                }),
              },
            },
          ],
        });

      try {
        const viewer = await login(fixture);
        const thread = await ensureAgentBuilderThread(
          fixture.bindings.DB,
          viewer,
          fixture.ids.agentId,
        );
        const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
          agentId: fixture.ids.agentId,
          draftRevision: "draft-rev-llm-published",
          draftYaml: DRAFT_YAML,
          inputText: "这个已发布 Agent 有 bug，帮我修配置",
          runtime: createAgentBuilderSystemAgentSubmitRuntime({
            bindings: fixture.bindings,
            viewer,
          }),
          threadId: thread.id,
        });
        const output = parseAgentBuilderPlannerOutput(
          JSON.parse(result.messages.at(-1)?.cardsJson ?? "null"),
        );

        expect(output?.mode).toBe("action");
        expect(output?.nodes[0]).toMatchObject({
          actions: [
            {
              actionKey: "apply_agent_config",
              label: "Apply changes",
              style: "primary",
            },
          ],
          nodeKey: "show_next_action:apply_agent_config",
        });
        expect(JSON.stringify(output)).not.toContain(quickstartAction.actionKey);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  test("default runtime discards mixed non-draft Quickstart outputs before persistence", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, {
      apiKey: "sk-unit-agent-builder",
      vendorId: "openai",
    });
    await fixture.bindings.DB.prepare("UPDATE agent SET status = 'published' WHERE id = ?")
      .bind(fixture.ids.agentId)
      .run();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                assistantText: "I changed the draft and can create the Agent.",
                intentSummary: "Mix a draft patch with a stale Quickstart action.",
                mode: "draft_patch",
                nodes: [
                  {
                    actions: [],
                    draftPatch: {
                      fieldPath: "description",
                      value: "Patched by mixed model output.",
                    },
                    kind: "draft_patch",
                    nodeKey: "patch_description",
                    operation: "update",
                    requiresConfirmation: false,
                    status: "pending",
                    summary: "Patch description from the model.",
                    targetType: "draft",
                  },
                  {
                    actions: [
                      {
                        actionKey: "create_agent",
                        label: "Create this agent",
                        style: "primary",
                      },
                    ],
                    kind: "action",
                    nodeKey: "show_next_action:create_agent",
                    operation: "show",
                    requiresConfirmation: false,
                    status: "pending",
                    summary: "Show a stale Quickstart action.",
                    targetType: "workflow",
                  },
                ],
                plannerRunId: "model-generated-run-id",
                version: 1,
              }),
            },
          },
        ],
      });

    try {
      const viewer = await login(fixture);
      const thread = await ensureAgentBuilderThread(
        fixture.bindings.DB,
        viewer,
        fixture.ids.agentId,
      );
      const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-llm-published-mixed",
        draftYaml: DRAFT_YAML,
        inputText: "这个已发布 Agent 有 bug，帮我修配置",
        runtime: createAgentBuilderSystemAgentSubmitRuntime({
          bindings: fixture.bindings,
          viewer,
        }),
        threadId: thread.id,
      });
      const assistantMessage = result.messages.at(-1);

      if (assistantMessage === undefined || assistantMessage.plannerRunId === null) {
        throw new Error("Expected assistant message with planner run id.");
      }

      const outputJson = assistantMessage.cardsJson ?? "null";
      const output = parseAgentBuilderPlannerOutput(JSON.parse(outputJson));
      const persistedPlannerRun = await fixture.bindings.DB.prepare(
        "SELECT output_json FROM agent_builder_planner_run WHERE id = ?",
      )
        .bind(assistantMessage.plannerRunId)
        .first<{ output_json: string }>();
      const persistedAssistantMessage = await fixture.bindings.DB.prepare(
        "SELECT cards_json FROM agent_builder_message WHERE id = ?",
      )
        .bind(assistantMessage.id)
        .first<{ cards_json: string | null }>();

      expect(output?.mode).toBe("action");
      expect(output?.nodes).toHaveLength(1);
      expect(output?.nodes[0]).toMatchObject({
        actions: [
          {
            actionKey: "apply_agent_config",
            label: "Apply changes",
            style: "primary",
          },
        ],
        nodeKey: "show_next_action:apply_agent_config",
      });
      expect(persistedPlannerRun?.output_json).toBe(outputJson);
      expect(persistedAssistantMessage?.cards_json).toBe(outputJson);
      expect(outputJson).not.toContain("create_agent");
      expect(outputJson).not.toContain("Patched by mixed model output");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default runtime blocks planning when the System Agent provider key is missing", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchUrls.push(readFetchUrl(url));
      return Response.json({});
    };

    try {
      const viewer = await login(fixture);
      const thread = await ensureAgentBuilderThread(
        fixture.bindings.DB,
        viewer,
        fixture.ids.agentId,
      );
      const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-llm-2",
        draftYaml: DRAFT_YAML,
        inputText: "帮我创建 Agent",
        runtime: createAgentBuilderSystemAgentSubmitRuntime({
          bindings: fixture.bindings,
          viewer,
        }),
        threadId: thread.id,
      });
      const output = parseAgentBuilderPlannerOutput(
        JSON.parse(result.messages.at(-1)?.cardsJson ?? "null"),
      );
      const plannerRunRow = await fixture.bindings.DB.prepare(
        "SELECT status FROM agent_builder_planner_run WHERE id = ?",
      )
        .bind(result.messages.at(-1)?.plannerRunId)
        .first<{ status: string }>();

      expect(fetchUrls).toEqual([]);
      expect(result.terminal.status).toBe("completed");
      expect(output?.mode).toBe("blocked");
      expect(output?.nodes[0]?.nodeKey).toBe("blocked_system_agent_credential_missing");
      expect(plannerRunRow?.status).toBe("blocked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default runtime blocks plaintext System Agent provider API bases", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await fixture.bindings.DB.prepare("UPDATE account SET system_agent_model = ? WHERE id = ?")
      .bind(
        JSON.stringify({ modelId: "custom-builder-model", vendor: "openai-compatible" }),
        fixture.viewer.id,
      )
      .run();
    await insertAgentBuilderVendorCredential(fixture, {
      apiBase: "http://public-provider.example/v1",
      apiKey: "sk-unit-agent-builder",
      models: ["custom-builder-model"],
      vendorId: "openai-compatible",
    });

    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchUrls.push(readFetchUrl(url));
      return Response.json({});
    };

    try {
      const viewer = await login(fixture);
      const thread = await ensureAgentBuilderThread(
        fixture.bindings.DB,
        viewer,
        fixture.ids.agentId,
      );
      const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-llm-http-base",
        draftYaml: DRAFT_YAML,
        inputText: "帮我创建 Agent",
        runtime: createAgentBuilderSystemAgentSubmitRuntime({
          bindings: fixture.bindings,
          viewer,
        }),
        threadId: thread.id,
      });
      const output = parseAgentBuilderPlannerOutput(
        JSON.parse(result.messages.at(-1)?.cardsJson ?? "null"),
      );

      expect(fetchUrls).toEqual([]);
      expect(output?.mode).toBe("blocked");
      expect(output?.nodes[0]?.nodeKey).toBe("blocked_system_agent_provider_invalid");
      expect(output?.nodes[0]?.summary).toBe("Provider API base is invalid: insecure_api_base.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default runtime routes structured question answers without a model request", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const context = plannerContext();
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchUrls.push(readFetchUrl(url));
      return Response.json({});
    };

    try {
      const output = await createAgentBuilderSystemAgentSubmitRuntime({
        bindings: fixture.bindings,
        viewer,
      }).planner.plan({
        context: {
          ...withPendingEnvironmentQuestion(context),
          turn: {
            ...context.turn,
            inputKind: "question_answer",
            inputText: JSON.stringify({
              customText: null,
              mode: "single_select",
              nodeKey: "ask_environment",
              selectedOptionKeys: [],
              skipped: true,
              type: "agent_builder_structured_input",
            }),
          },
        },
      });

      expect(fetchUrls).toEqual([]);
      expect(output.mode).toBe("draft_patch");
      expect(output.nodes[0]?.draftPatch).toMatchObject({
        fieldPath: "componentDecisions.environment",
        value: "skipped",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("default runtime blocks invalid model planner JSON without applying draft patches", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, {
      apiKey: "sk-unit-agent-builder",
      vendorId: "openai",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mode: "draft_patch",
                nodes: [],
                plannerRunId: "invalid",
                version: 1,
              }),
            },
          },
        ],
      });

    try {
      const viewer = await login(fixture);
      const thread = await ensureAgentBuilderThread(
        fixture.bindings.DB,
        viewer,
        fixture.ids.agentId,
      );
      const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-llm-3",
        draftYaml: DRAFT_YAML,
        inputText: "帮我改 prompt",
        runtime: createAgentBuilderSystemAgentSubmitRuntime({
          bindings: fixture.bindings,
          viewer,
        }),
        threadId: thread.id,
      });
      const output = parseAgentBuilderPlannerOutput(
        JSON.parse(result.messages.at(-1)?.cardsJson ?? "null"),
      );

      expect(output?.mode).toBe("blocked");
      expect(output?.nodes[0]?.nodeKey).toBe("blocked_system_agent_invalid_planner_output");
      expect(output?.nodes.some((node) => node.kind === "draft_patch")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps the Create Agent action until the control-plane action applies the Manifest", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, { vendorId: "anthropic" });

    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const runtime = createDeterministicAgentBuilderRuntime(fixture, viewer);
    const createActionResult = await submitAgentBuilderSystemAgentMessage(
      fixture.bindings,
      viewer,
      {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-1",
        draftYaml: DRAFT_YAML,
        inputText: "帮我配置下一步",
        runtime,
        threadId: thread.id,
      },
    );
    const createActionOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(createActionResult.messages.at(-1)?.cardsJson ?? "null"),
    );

    expect(createActionOutput?.mode).toBe("action");
    expect(createActionOutput?.nodes[0]?.nodeKey).toBe("show_next_action:create_agent");
    expect(createActionOutput?.nodes[0]?.actions[0]).toEqual({
      actionKey: "create_agent",
      label: "Create this agent",
      style: "primary",
    });

    const repeatedCreateActionResult = await submitAgentBuilderSystemAgentMessage(
      fixture.bindings,
      viewer,
      {
        agentId: fixture.ids.agentId,
        draftRevision: "draft-rev-2",
        draftYaml: DRAFT_YAML,
        inputText: "继续配置 environment",
        runtime,
        threadId: thread.id,
      },
    );
    const repeatedCreateActionOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(repeatedCreateActionResult.messages.at(-1)?.cardsJson ?? "null"),
    );

    expect(repeatedCreateActionOutput?.mode).toBe("action");
    expect(repeatedCreateActionOutput?.nodes[0]?.nodeKey).toBe("show_next_action:create_agent");

    await executeFixtureControlPlaneAction(fixture, viewer, {
      agentId: fixture.ids.agentId,
      draftYaml: DRAFT_YAML,
      toolId: "create_agent",
    });

    const environmentResult = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-3",
      draftYaml: DRAFT_YAML,
      inputText: "现在继续配置 environment",
      runtime,
      threadId: thread.id,
    });
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(environmentResult.messages.at(-1)?.cardsJson ?? "null"),
    );

    expect(plannerOutput?.mode).toBe("question");
    expect(plannerOutput?.nodes).toHaveLength(1);
    expect(plannerOutput?.nodes[0]?.nodeKey).toBe("ask_environment");
    expect(plannerOutput?.nodes[0]?.askUser?.mode).toBe("single_select");
    expect(plannerOutput?.nodes[0]?.askUser?.allowCustomText).toBe(true);
    expect(plannerOutput?.nodes[0]?.askUser?.allowSkip).toBe(true);
    expect(
      plannerOutput?.nodes[0]?.askUser?.options.some((option) =>
        option.optionKey.startsWith("environment:"),
      ),
    ).toBe(true);
  });

  test("applies a selected Environment structured reply as a manifest patch", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, { vendorId: "anthropic" });

    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const runtime = createDeterministicAgentBuilderRuntime(fixture, viewer);
    await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "先创建 Agent",
      runtime,
      threadId: thread.id,
    });
    await executeFixtureControlPlaneAction(fixture, viewer, {
      agentId: fixture.ids.agentId,
      draftYaml: DRAFT_YAML,
      toolId: "create_agent",
    });
    const questionResult = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "帮我配置 environment",
      runtime,
      threadId: thread.id,
    });
    const questionOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(questionResult.messages.at(-1)?.cardsJson ?? "null"),
    );
    const environmentOption = questionOutput?.nodes[0]?.askUser?.options.find((option) =>
      option.optionKey.startsWith("environment:"),
    );

    if (environmentOption === undefined) {
      throw new Error("Expected a visible Environment option.");
    }

    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-2",
      draftYaml: DRAFT_YAML,
      inputText: JSON.stringify({
        customText: null,
        mode: "single_select",
        nodeKey: "ask_environment",
        selectedOptionKeys: [environmentOption.optionKey],
        skipped: false,
        type: "agent_builder_structured_input",
      }),
      runtime,
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const patchNode = plannerOutput?.nodes[0];

    expect(plannerOutput?.mode).toBe("draft_patch");
    expect(patchNode?.status).toBe("applied");
    expect(patchNode?.operation).toBe("bind");
    expect(patchNode?.draftPatch).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-2",
      baseValue: null,
      fieldPath: "environmentId",
      sectionId: "environment",
      value: environmentOption.value,
    });
    expect(patchNode?.draftPatch?.resolvedReferences?.[0]).toMatchObject({
      id: environmentOption.value,
      name: environmentOption.label,
      targetType: "environment",
    });

    const row = await fixture.bindings.DB.prepare(
      "SELECT context_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(assistantMessage?.plannerRunId)
      .first<{ context_json: string }>();

    expect(row?.context_json).toContain('"inputKind":"question_answer"');
  });

  test("rejects stale Environment structured replies after the question was answered", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, { vendorId: "anthropic" });

    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const runtime = createDeterministicAgentBuilderRuntime(fixture, viewer);

    await executeFixtureControlPlaneAction(fixture, viewer, {
      agentId: fixture.ids.agentId,
      draftYaml: DRAFT_YAML,
      toolId: "create_agent",
    });
    const questionResult = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "帮我配置 environment",
      runtime,
      threadId: thread.id,
    });
    const questionOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(questionResult.messages.at(-1)?.cardsJson ?? "null"),
    );
    const environmentOption = questionOutput?.nodes[0]?.askUser?.options.find((option) =>
      option.optionKey.startsWith("environment:"),
    );

    if (environmentOption === undefined) {
      throw new Error("Expected a visible Environment option.");
    }

    await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-2",
      draftYaml: DRAFT_YAML,
      inputText: JSON.stringify({
        customText: null,
        mode: "single_select",
        nodeKey: "ask_environment",
        selectedOptionKeys: [environmentOption.optionKey],
        skipped: false,
        type: "agent_builder_structured_input",
      }),
      runtime,
      threadId: thread.id,
    });

    const staleReplyResult = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-3",
      draftYaml: DRAFT_YAML.replace(
        "  environmentId: null",
        `  environmentId: ${environmentOption.value}`,
      ),
      inputText: JSON.stringify({
        customText: null,
        mode: "single_select",
        nodeKey: "ask_environment",
        selectedOptionKeys: [],
        skipped: true,
        type: "agent_builder_structured_input",
      }),
      runtime,
      threadId: thread.id,
    });
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(staleReplyResult.messages.at(-1)?.cardsJson ?? "null"),
    );

    expect(plannerOutput?.mode).toBe("plain_text");
    expect(plannerOutput?.nodes).toEqual([]);
    expect(staleReplyResult.messages.at(-1)?.contentText).toContain("已过期");
  });

  test("emits a secure create-Environment action for create-new Environment replies", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithBoundEnvironment();
    const output = await planner.plan({
      context: {
        ...withPendingEnvironmentQuestion(context),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "single_select",
            nodeKey: "ask_environment",
            selectedOptionKeys: ["action:create_environment"],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("action");
    expect(output.nodes[0]).toMatchObject({
      actions: [
        {
          actionKey: "create_environment",
          label: "Create Environment",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:create_environment",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
  });

  test("emits a secure create-Environment action for free-text Environment replies", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContext();
    const output = await planner.plan({
      context: {
        ...withPendingEnvironmentQuestion(context),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: "Use Python 3.12 and install the GitHub CLI.",
            mode: "free_text",
            nodeKey: "ask_environment",
            selectedOptionKeys: [],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("action");
    expect(output.nodes[0]).toMatchObject({
      actions: [
        {
          actionKey: "create_environment",
          label: "Create Environment",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:create_environment",
      operation: "show",
      status: "pending",
      targetType: "workflow",
    });
  });

  test("applies a skipped Environment structured reply as a durable Manifest decision", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAgentBuilderVendorCredential(fixture, { vendorId: "anthropic" });

    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const runtime = createDeterministicAgentBuilderRuntime(fixture, viewer);

    await executeFixtureControlPlaneAction(fixture, viewer, {
      agentId: fixture.ids.agentId,
      draftYaml: DRAFT_YAML,
      toolId: "create_agent",
    });
    await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "配置 Environment",
      runtime,
      threadId: thread.id,
    });

    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-2",
      draftYaml: DRAFT_YAML,
      inputText: JSON.stringify({
        customText: null,
        mode: "single_select",
        nodeKey: "ask_environment",
        selectedOptionKeys: [],
        skipped: true,
        type: "agent_builder_structured_input",
      }),
      runtime,
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const patchNode = plannerOutput?.nodes[0];

    expect(plannerOutput?.mode).toBe("draft_patch");
    expect(patchNode?.status).toBe("applied");
    expect(patchNode?.draftPatch).toMatchObject({
      autoApply: true,
      baseDraftRevision: "draft-rev-2",
      baseValue: null,
      fieldPath: "componentDecisions.environment",
      sectionId: "environment",
      value: "skipped",
    });
  });

  test("routes unknown pending ask_user replies back to the LLM planner", () => {
    const context = plannerContext();
    const route = selectAgentBuilderSystemAgentPlannerRoute({
      ...context,
      historicalOpenNodes: [
        {
          actions: [],
          askUser: {
            allowCustomText: true,
            allowSkip: false,
            mode: "free_text",
            options: [],
            prompt: "What should this agent do next?",
            submitLabel: "Continue",
          },
          kind: "question",
          nodeKey: "llm_followup_goal",
          operation: "ask",
          requiresConfirmation: false,
          status: "pending",
          summary: "Ask a generic LLM follow-up.",
          targetType: "workflow",
        },
      ],
      turn: {
        ...context.turn,
        inputKind: "question_answer",
        inputText: JSON.stringify({
          customText: "Make it review security findings.",
          mode: "free_text",
          nodeKey: "llm_followup_goal",
          selectedOptionKeys: [],
          skipped: false,
          type: "agent_builder_structured_input",
        }),
      },
    });

    expect(route).toBe("llm");
  });

  test("handles pending published Environment structured replies before refactor mode", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContext();
    const output = await planner.plan({
      context: {
        ...withPendingEnvironmentQuestion(context),
        agent: {
          ...context.agent,
          status: "published",
        },
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "single_select",
            nodeKey: "ask_environment",
            selectedOptionKeys: [],
            skipped: true,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("draft_patch");
    expect(output.nodes[0]?.nodeKey).toBe("patch_environment_decision");
  });

  test("rejects structured Environment replies without a pending Environment question", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContextWithBoundEnvironment();
    const output = await planner.plan({
      context: {
        ...context,
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "single_select",
            nodeKey: "ask_environment",
            selectedOptionKeys: [],
            skipped: true,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).not.toBe("draft_patch");
    expect(output.nodes[0]?.nodeKey).not.toBe("patch_environment_decision");
  });

  test("rejects structured Environment reply mode drift", async () => {
    const planner = createDefaultAgentBuilderLightweightPlanner();
    const context = plannerContext();
    const output = await planner.plan({
      context: {
        ...withPendingEnvironmentQuestion(context),
        turn: {
          ...context.turn,
          inputText: JSON.stringify({
            customText: null,
            mode: "single_select",
            nodeKey: "ask_environment",
            selectedOptionKeys: ["environment:a", "environment:b"],
            skipped: false,
            type: "agent_builder_structured_input",
          }),
        },
      },
    });

    expect(output.mode).toBe("plain_text");
    expect(output.intentSummary).toBe("Reject a malformed Environment structured reply.");
  });

  test("uses a persisted Environment skip decision to show the Preview action", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-2",
      draftYaml: DRAFT_YAML_WITH_SKIPPED_ENVIRONMENT,
      inputText: "下一步",
      runtime: createDeterministicAgentBuilderRuntime(fixture, viewer),
      threadId: thread.id,
    });
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(result.messages.at(-1)?.cardsJson ?? "null"),
    );

    expect(plannerOutput?.mode).toBe("action");
    expect(plannerOutput?.nodes[0]?.nodeKey).toBe("show_next_action:open_preview");
  });

  test("uses the opened Preview marker as Step 3 active before a Session exists", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);

    await executeFixtureControlPlaneAction(fixture, viewer, {
      agentId: fixture.ids.agentId,
      toolId: "open_preview",
    });

    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-3",
      draftYaml: DRAFT_YAML_WITH_SKIPPED_ENVIRONMENT,
      inputText: "Preview 已打开但还没发送测试消息，下一步是什么",
      runtime: createDeterministicAgentBuilderRuntime(fixture, viewer),
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected lightweight planner run id.");
    }

    const plannerRun = await fixture.bindings.DB.prepare(
      "SELECT context_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{ context_json: string }>();
    const sessionCount = await fixture.bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM session WHERE agent_id = ? AND type = 'preview'",
    )
      .bind(fixture.ids.agentId)
      .first<{ count: number }>();

    expect(plannerOutput?.mode).toBe("plain_text");
    expect(JSON.parse(plannerRun?.context_json ?? "{}")).toMatchObject({
      preview: {
        messageCount: 0,
        opened: true,
        sessionExists: false,
      },
    });
    expect(sessionCount?.count).toBe(0);
  });

  test("persists the reused preview Session snapshot that matches Preview panel selection", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const previewMessageAt = 1_775_000_000_000;
    const otherViewerId = "01J00000000000000000000061";

    await insertPreviewSession(fixture, {
      createdAt: previewMessageAt - 4_000,
      creatorAccountId: viewer.id,
      id: "01J00000000000000000009999",
      lastMessageAt: previewMessageAt - 3_000,
      messageSeqCursor: 8,
      updatedAt: previewMessageAt - 3_000,
    });
    await insertPreviewSession(fixture, {
      createdAt: previewMessageAt - 3_000,
      creatorAccountId: otherViewerId,
      id: "01J0000000000000000000999A",
      lastMessageAt: previewMessageAt + 2_000,
      messageSeqCursor: 9,
      updatedAt: previewMessageAt + 2_000,
    });
    await insertPreviewSession(fixture, {
      archivedAt: previewMessageAt + 2_500,
      createdAt: previewMessageAt - 2_000,
      creatorAccountId: viewer.id,
      id: "01J0000000000000000000999B",
      lastMessageAt: previewMessageAt + 3_000,
      messageSeqCursor: 10,
      updatedAt: previewMessageAt + 3_000,
    });
    await insertPreviewSession(fixture, {
      createdAt: previewMessageAt - 1_000,
      creatorAccountId: viewer.id,
      id: "01J00000000000000000009998",
      lastMessageAt: previewMessageAt,
      messageSeqCursor: 3,
      updatedAt: previewMessageAt,
    });

    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-3",
      draftYaml: DRAFT_YAML_WITH_SKIPPED_ENVIRONMENT,
      inputText: "Preview 已经聊过了，下一步是什么",
      runtime: createDeterministicAgentBuilderRuntime(fixture, viewer),
      threadId: thread.id,
    });
    const assistantMessage = result.messages.at(-1);
    const plannerOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );
    const plannerRunRow = await fixture.bindings.DB.prepare(
      "SELECT context_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(assistantMessage?.plannerRunId)
      .first<{ context_json: string }>();

    expect(plannerOutput?.mode).toBe("plain_text");
    expect(JSON.parse(plannerRunRow?.context_json ?? "{}")).toMatchObject({
      preview: {
        messageCount: 3,
        opened: true,
        sessionExists: true,
      },
    });
  });

  test("lists participant-visible preview Sessions for Builder Preview selection", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const previewMessageAt = 1_775_000_000_000;
    const currentViewerSessionId = "01J00000000000000000009998";
    const otherViewerSessionId = "01J00000000000000000009999";
    const archivedCurrentViewerSessionId = "01J0000000000000000000999A";

    await insertPreviewSession(fixture, {
      createdAt: previewMessageAt - 1_000,
      creatorAccountId: viewer.id,
      id: currentViewerSessionId,
      lastMessageAt: previewMessageAt,
      messageSeqCursor: 3,
      updatedAt: previewMessageAt,
    });
    await insertPreviewSession(fixture, {
      createdAt: previewMessageAt - 500,
      creatorAccountId: "01J00000000000000000000061",
      id: otherViewerSessionId,
      lastMessageAt: previewMessageAt + 1_000,
      messageSeqCursor: 7,
      updatedAt: previewMessageAt + 1_000,
    });
    await insertPreviewSession(fixture, {
      archivedAt: previewMessageAt + 2_000,
      createdAt: previewMessageAt - 250,
      creatorAccountId: viewer.id,
      id: archivedCurrentViewerSessionId,
      lastMessageAt: previewMessageAt + 2_000,
      messageSeqCursor: 9,
      updatedAt: previewMessageAt + 2_000,
    });

    const participantVisibleSessions = await listAgentSessions(fixture.bindings.DB, viewer, {
      agentId: fixture.ids.agentId,
      archived: false,
      participantOnly: true,
      appId: fixture.ids.appId,
      type: "preview",
    });
    const editorVisibleSessions = await listAgentSessions(fixture.bindings.DB, viewer, {
      agentId: fixture.ids.agentId,
      archived: false,
      appId: fixture.ids.appId,
      type: "preview",
    });

    expect(participantVisibleSessions.nodes.map((session) => session.id)).toEqual([
      currentViewerSessionId,
    ]);
    expect(editorVisibleSessions.nodes.map((session) => session.id)).toEqual([
      otherViewerSessionId,
      currentViewerSessionId,
    ]);
  });
});
