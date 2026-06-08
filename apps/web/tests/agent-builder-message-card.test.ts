import { describe, expect, test } from "bun:test";

import type { AgentBuilderPlanNode } from "@mosoo/contracts/agent-builder";

import {
  shouldRenderAgentBuilderPlanNode,
  shouldRenderAgentBuilderPlanNodeControls,
} from "../src/routes/agent/components/agent-builder/agent-builder-message-card";

function planNode(overrides: Partial<AgentBuilderPlanNode>): AgentBuilderPlanNode {
  return {
    actions: [],
    kind: "draft_patch",
    nodeKey: "node_1",
    operation: "update",
    requiresConfirmation: false,
    status: "pending",
    summary: "Update the Agent name.",
    targetType: "draft",
    ...overrides,
  };
}

describe("Agent Builder message card planner node rules", () => {
  test("hides applied nodes because auto-applied patches update the form directly", () => {
    expect(
      shouldRenderAgentBuilderPlanNode(
        planNode({
          draftPatch: {
            autoApply: true,
            fieldPath: "name",
            value: "Support Agent",
          },
          status: "applied",
        }),
      ),
    ).toBe(false);
  });

  test("renders pending and issue nodes without making status labels part of the UI contract", () => {
    expect(shouldRenderAgentBuilderPlanNode(planNode({ status: "pending" }))).toBe(true);
    expect(shouldRenderAgentBuilderPlanNode(planNode({ status: "blocked" }))).toBe(true);
    expect(shouldRenderAgentBuilderPlanNode(planNode({ status: "failed" }))).toBe(true);
  });

  test("only pending nodes may render interactive controls", () => {
    expect(shouldRenderAgentBuilderPlanNodeControls(planNode({ status: "pending" }))).toBe(true);
    expect(shouldRenderAgentBuilderPlanNodeControls(planNode({ status: "blocked" }))).toBe(false);
    expect(shouldRenderAgentBuilderPlanNodeControls(planNode({ status: "failed" }))).toBe(false);
    expect(shouldRenderAgentBuilderPlanNodeControls(planNode({ status: "applied" }))).toBe(false);
  });
});
