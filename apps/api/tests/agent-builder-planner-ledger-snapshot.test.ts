import { describe, expect, test } from "bun:test";

import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderMessageId, AgentBuilderPlannerRunId } from "@mosoo/id";

import {
  createAgentBuilderMessageId,
  createAgentBuilderPlannerRunId,
} from "../src/modules/agent-builder/application/agent-builder-ids";
import { readAgentBuilderPlannerLedgerSnapshot } from "../src/modules/agent-builder/application/agent-builder-planner-ledger-snapshot.service";
import { ensureAgentBuilderThread } from "../src/modules/agent-builder/application/agent-builder-thread.service";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

function actionNode(nodeKey: string, status: AgentBuilderPlanNode["status"]): AgentBuilderPlanNode {
  return {
    actions: [
      {
        actionKey: "create_agent",
        label: "Create this agent",
        style: "primary",
      },
    ],
    kind: "action",
    nodeKey,
    operation: "show",
    requiresConfirmation: false,
    status,
    summary: "Show Create Agent action.",
    targetType: "workflow",
  };
}

function pendingActionNode(nodeKey: string): AgentBuilderPlanNode {
  return actionNode(nodeKey, "pending");
}

function questionNode(
  nodeKey: string,
  status: AgentBuilderPlanNode["status"],
): AgentBuilderPlanNode {
  return {
    actions: [],
    askUser: {
      allowCustomText: true,
      allowSkip: true,
      mode: "single_select",
      options: [
        {
          label: "Support Env",
          optionKey: "environment:support",
          value: "support",
        },
      ],
      prompt: "Choose an Environment.",
      submitLabel: "Continue",
    },
    kind: "question",
    nodeKey,
    operation: "ask",
    requiresConfirmation: false,
    status,
    summary: "Ask for Environment.",
    targetType: "environment",
  };
}

function plannerOutputJson(input: {
  readonly mode: AgentBuilderPlannerOutput["mode"];
  readonly nodes: readonly AgentBuilderPlanNode[];
  readonly plannerRunId: AgentBuilderPlannerRunId;
}): string {
  return JSON.stringify({
    assistantText: "planner output",
    intentSummary: "test planner output",
    mode: input.mode,
    nodes: input.nodes,
    plannerRunId: input.plannerRunId,
    version: 1,
  } satisfies AgentBuilderPlannerOutput);
}

async function insertPlannerRun(input: {
  readonly agentId: string;
  readonly contextJson: string;
  readonly createdAt: number;
  readonly database: D1Database;
  readonly id: AgentBuilderPlannerRunId;
  readonly outputJson: string | null;
  readonly status?: string;
  readonly threadId: string;
  readonly triggerMessageId?: AgentBuilderMessageId | null;
}): Promise<void> {
  await input.database
    .prepare(
      `INSERT INTO agent_builder_planner_run (
        agent_id,
        completed_at,
        context_json,
        created_at,
        error_code,
        error_message,
        id,
        model,
        output_json,
        provider,
        request_digest,
        status,
        thread_id,
        trace_id,
        tool_trace_json,
        trigger_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.agentId,
      input.createdAt + 1,
      input.contextJson,
      input.createdAt,
      null,
      null,
      input.id,
      "heuristic",
      input.outputJson,
      "agent-builder-lightweight",
      `digest-${input.id}`,
      input.status ?? "completed",
      input.threadId,
      input.id,
      null,
      input.triggerMessageId ?? null,
    )
    .run();
}

async function insertBuilderMessage(input: {
  readonly contentText: string;
  readonly createdAt: number;
  readonly database: D1Database;
  readonly id: AgentBuilderMessageId;
  readonly inputKind: string;
  readonly seq: number;
  readonly threadId: string;
  readonly viewerId: string;
}): Promise<void> {
  await input.database
    .prepare(
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
      input.contentText,
      input.createdAt,
      input.viewerId,
      input.id,
      input.inputKind,
      null,
      "user",
      input.seq,
      input.threadId,
    )
    .run();
}

describe("Agent Builder planner ledger snapshot", () => {
  test("replays historical messages by ledger contract", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );
    const historicalJsonMessage = '{"requested_agent":"docs helper"}';

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
        historicalJsonMessage,
        1_001,
        fixture.viewer.id,
        createAgentBuilderMessageId(),
        "user_message",
        null,
        "user",
        1,
        thread.id,
      )
      .run();

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);
    const replayJson = JSON.stringify(snapshot.recentMessages);

    expect(replayJson).toContain("docs helper");
    expect(snapshot.recentMessages[0]?.contentText).toBe(historicalJsonMessage);
  });

  test("replays historical planner output by JSON contract", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );
    const oldRunId = createAgentBuilderPlannerRunId();
    const latestRunId = createAgentBuilderPlannerRunId();

    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "old" }),
      createdAt: 10,
      database: fixture.bindings.DB,
      id: oldRunId,
      outputJson: plannerOutputJson({
        mode: "action",
        nodes: [pendingActionNode("old_create_agent")],
        plannerRunId: oldRunId,
      }),
      threadId: thread.id,
    });
    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "latest-action" }),
      createdAt: 20,
      database: fixture.bindings.DB,
      id: latestRunId,
      outputJson: plannerOutputJson({
        mode: "action",
        nodes: [
          {
            ...pendingActionNode("latest_create_agent"),
            summary: "Ready to create the Agent.",
          },
        ],
        plannerRunId: latestRunId,
      }),
      threadId: thread.id,
    });

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);
    const snapshotJson = JSON.stringify(snapshot);

    expect(snapshotJson).toContain("Ready to create the Agent.");
    expect(snapshot.historicalOpenNodes.map((node) => node.nodeKey)).toEqual([
      "latest_create_agent",
      "old_create_agent",
    ]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  test("does not replay pending nodes from blocked planner runs", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );
    const blockedRunId = createAgentBuilderPlannerRunId();

    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "blocked" }),
      createdAt: 20,
      database: fixture.bindings.DB,
      id: blockedRunId,
      outputJson: plannerOutputJson({
        mode: "blocked",
        nodes: [pendingActionNode("blocked_create_agent")],
        plannerRunId: blockedRunId,
      }),
      status: "blocked",
      threadId: thread.id,
    });

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);

    expect(snapshot.historicalOpenNodes).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  test("reads recent messages, previous visible asset cache, and historical pending nodes from the Builder ledger", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );

    for (let seq = 1; seq <= 13; seq += 1) {
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
          `message-${seq}`,
          1_000 + seq,
          fixture.viewer.id,
          createAgentBuilderMessageId(),
          "user_message",
          null,
          seq % 2 === 0 ? "assistant" : "user",
          seq,
          thread.id,
        )
        .run();
    }

    const oldRunId = createAgentBuilderPlannerRunId();
    const middleRunId = createAgentBuilderPlannerRunId();
    const latestRunId = createAgentBuilderPlannerRunId();

    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "old" }),
      createdAt: 10,
      database: fixture.bindings.DB,
      id: oldRunId,
      outputJson: plannerOutputJson({
        mode: "action",
        nodes: [pendingActionNode("old_create_agent")],
        plannerRunId: oldRunId,
      }),
      threadId: thread.id,
    });
    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "middle" }),
      createdAt: 20,
      database: fixture.bindings.DB,
      id: middleRunId,
      outputJson: plannerOutputJson({
        mode: "question",
        nodes: [
          questionNode("applied_question", "applied"),
          questionNode("ask_environment", "pending"),
        ],
        plannerRunId: middleRunId,
      }),
      threadId: thread.id,
    });
    const latestContextJson = JSON.stringify({
      assets: {
        currentIndex: {
          skills: [],
        },
        observedAt: "2026-06-07T00:00:00.000Z",
        snapshotHash: "latest-visible-assets",
      },
    });

    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: latestContextJson,
      createdAt: 30,
      database: fixture.bindings.DB,
      id: latestRunId,
      outputJson: plannerOutputJson({
        mode: "action",
        nodes: [
          actionNode("failed_create_agent", "failed"),
          pendingActionNode("latest_create_agent"),
          questionNode("blocked_question", "blocked"),
          questionNode("applied_question_latest", "applied"),
        ],
        plannerRunId: latestRunId,
      }),
      threadId: thread.id,
    });

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);

    expect(snapshot.recentMessages.map((message) => message.seq)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(snapshot.previousVisibleAssets.assets?.snapshotHash).toBe("latest-visible-assets");
    expect(snapshot.previousVisibleAssets.context.status).toBe("available");
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.historicalOpenNodes.map((node) => node.nodeKey)).toEqual([
      "latest_create_agent",
      "ask_environment",
      "old_create_agent",
    ]);
  });

  test("does not treat an earlier same-time structured answer as answering a later question", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );
    const answerMessageId = createAgentBuilderMessageId();
    const triggerMessageId = createAgentBuilderMessageId();
    const plannerRunId = createAgentBuilderPlannerRunId();
    const sameTimestamp = 1_000;

    await insertBuilderMessage({
      contentText: JSON.stringify({
        customText: null,
        mode: "single_select",
        nodeKey: "ask_environment",
        selectedOptionKeys: [],
        skipped: true,
        type: "agent_builder_structured_input",
      }),
      createdAt: sameTimestamp,
      database: fixture.bindings.DB,
      id: answerMessageId,
      inputKind: "question_answer",
      seq: 3,
      threadId: thread.id,
      viewerId: fixture.viewer.id,
    });
    await insertBuilderMessage({
      contentText: "Ask again",
      createdAt: sameTimestamp,
      database: fixture.bindings.DB,
      id: triggerMessageId,
      inputKind: "user_message",
      seq: 4,
      threadId: thread.id,
      viewerId: fixture.viewer.id,
    });
    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "same-time-later-question" }),
      createdAt: sameTimestamp,
      database: fixture.bindings.DB,
      id: plannerRunId,
      outputJson: plannerOutputJson({
        mode: "question",
        nodes: [questionNode("ask_environment", "pending")],
        plannerRunId,
      }),
      threadId: thread.id,
      triggerMessageId,
    });

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);

    expect(snapshot.historicalOpenNodes.map((node) => node.nodeKey)).toEqual(["ask_environment"]);
  });

  test("surfaces invalid completed planner output instead of falling back to older pending nodes", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const thread = await ensureAgentBuilderThread(
      fixture.bindings.DB,
      fixture.viewer,
      fixture.ids.agentId,
    );
    const oldRunId = createAgentBuilderPlannerRunId();
    const latestRunId = createAgentBuilderPlannerRunId();

    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "old" }),
      createdAt: 10,
      database: fixture.bindings.DB,
      id: oldRunId,
      outputJson: plannerOutputJson({
        mode: "action",
        nodes: [pendingActionNode("old_create_agent")],
        plannerRunId: oldRunId,
      }),
      threadId: thread.id,
    });
    await insertPlannerRun({
      agentId: fixture.ids.agentId,
      contextJson: JSON.stringify({ marker: "latest-invalid" }),
      createdAt: 20,
      database: fixture.bindings.DB,
      id: latestRunId,
      outputJson: JSON.stringify({ invalid: true }),
      threadId: thread.id,
    });

    const snapshot = await readAgentBuilderPlannerLedgerSnapshot(fixture.bindings.DB, thread.id);

    expect(snapshot.historicalOpenNodes).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      {
        code: "invalid_planner_output",
        message: "A completed Agent Builder planner run contains invalid output JSON.",
        plannerRunId: latestRunId,
        severity: "warning",
      },
    ]);
  });
});
