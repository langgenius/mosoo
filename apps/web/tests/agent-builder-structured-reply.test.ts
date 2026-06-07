import { describe, expect, test } from "bun:test";

import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderPlannerRunId, AgentBuilderThreadId } from "@mosoo/contracts/id";

import type { AgentBuilderMessage } from "../src/domains/agent-builder/api/agent-builder-client";
import { createAgentBuilderStructuredReplyText } from "../src/routes/agent/components/agent-builder/agent-builder-ask-user-card";
import { getLatestActionableStructuredReplyMessageId } from "../src/routes/agent/components/agent-builder/agent-builder-structured-reply-state";

function createQuestionNode(nodeKey: string, status: AgentBuilderPlanNode["status"]) {
  return {
    actions: [],
    askUser: {
      allowCustomText: true,
      allowSkip: true,
      mode: "single_select",
      options: [{ label: "Option A", optionKey: "option_a" }],
      prompt: "Choose one.",
    },
    kind: "question",
    nodeKey,
    operation: "ask",
    requiresConfirmation: false,
    status,
    summary: "Choose one.",
    targetType: "environment",
  } satisfies AgentBuilderPlanNode;
}

function createPlannerCardsJson(nodes: readonly AgentBuilderPlanNode[]): string {
  const output = {
    assistantText: nodes.length === 0 ? "Done." : "Question.",
    intentSummary: "test",
    mode: nodes.length === 0 ? "plain_text" : "question",
    nodes,
    plannerRunId: "planner_run_test" as AgentBuilderPlannerRunId,
    version: 1,
  } satisfies AgentBuilderPlannerOutput;

  return JSON.stringify(output);
}

function createBuilderMessage(input: {
  cardsJson: string | null;
  id: string;
  role?: AgentBuilderMessage["role"];
  seq: number;
}): AgentBuilderMessage {
  return {
    cardsJson: input.cardsJson,
    contentText: "message",
    createdAt: new Date(input.seq).toISOString(),
    createdByAccountId: null,
    id: input.id,
    inputKind: null,
    plannerRunId: null,
    role: input.role ?? "assistant",
    seq: input.seq,
    threadId: "thread_test" as AgentBuilderThreadId,
  };
}

describe("Agent Builder structured reply", () => {
  test("serializes ask-user choices as structured control input", () => {
    expect(
      JSON.parse(
        createAgentBuilderStructuredReplyText({
          customText: "Use a smaller environment if possible.",
          mode: "single_select",
          nodeKey: "ask_environment",
          selectedOptionKeys: ["environment_analysis"],
          skipped: false,
        }),
      ),
    ).toEqual({
      customText: "Use a smaller environment if possible.",
      mode: "single_select",
      nodeKey: "ask_environment",
      selectedOptionKeys: ["environment_analysis"],
      skipped: false,
      type: "agent_builder_structured_input",
    });
  });

  test("allows structured replies only for the latest pending ask-user planner output", () => {
    const firstQuestion = createBuilderMessage({
      cardsJson: createPlannerCardsJson([createQuestionNode("ask_environment", "pending")]),
      id: "message_first_question",
      seq: 1,
    });
    const latestQuestion = createBuilderMessage({
      cardsJson: createPlannerCardsJson([createQuestionNode("ask_skill", "pending")]),
      id: "message_latest_question",
      seq: 2,
    });

    expect(getLatestActionableStructuredReplyMessageId([firstQuestion, latestQuestion])).toBe(
      "message_latest_question",
    );
  });

  test("disables historical ask-user cards after a newer non-question planner output", () => {
    const firstQuestion = createBuilderMessage({
      cardsJson: createPlannerCardsJson([createQuestionNode("ask_environment", "pending")]),
      id: "message_first_question",
      seq: 1,
    });
    const latestPlainText = createBuilderMessage({
      cardsJson: createPlannerCardsJson([]),
      id: "message_latest_plain_text",
      seq: 2,
    });

    expect(getLatestActionableStructuredReplyMessageId([firstQuestion, latestPlainText])).toBe(
      null,
    );
  });
});
