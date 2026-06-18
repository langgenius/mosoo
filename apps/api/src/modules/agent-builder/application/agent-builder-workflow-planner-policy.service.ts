import type {
  AgentBuilderNextAction,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";

import { planAgentBuilderOptionalComponentRequest } from "./agent-builder-component-planner-policy.service";
import { createAgentBuilderEnvironmentQuestionPlannerOutput } from "./agent-builder-environment-planner-policy.service";
import { toAgentBuilderWorkflowDraftSnapshot } from "./agent-builder-lightweight-manifest-projections";
import {
  createAgentBuilderActionPlannerOutput,
  createAgentBuilderPlainTextPlannerOutput,
} from "./agent-builder-planner-output-factory";
import { deriveAgentBuilderWorkflowState } from "./agent-builder-workflow-stage.service";

const APPLY_AGENT_CONFIG_ACTION_KEY = "apply_agent_config";
const CREATE_AGENT_ACTION_KEY = "create_agent";

function createNextActionPlannerOutput(input: {
  readonly assistantText: string;
  readonly context: AgentBuilderPlannerContext;
  readonly intentSummary: string;
  readonly nextAction: AgentBuilderNextAction;
  readonly summary: string;
}): AgentBuilderPlannerOutput {
  return createAgentBuilderActionPlannerOutput({
    actionKey: input.nextAction.kind,
    assistantText: input.assistantText,
    context: input.context,
    intentSummary: input.intentSummary,
    label: input.nextAction.label,
    summary: input.summary,
  });
}

function shouldShowCreateAgentAction(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly nextAction: AgentBuilderNextAction;
}): boolean {
  return (
    input.context.agent.status === "draft" &&
    input.nextAction.kind === "configure_environment" &&
    !input.context.agent.baseConfigApplied
  );
}

export function planAgentBuilderRefactorTurn(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerOutput {
  return createAgentBuilderActionPlannerOutput({
    actionKey: APPLY_AGENT_CONFIG_ACTION_KEY,
    assistantText:
      "我会把当前 Agent 当成已存在的 Manifest 来协助 refactor：可以继续修改名称、描述、模型、系统提示词，或调整 Environment、Skill、MCP 绑定；不会重新带你走 Quickstart 初始化步骤。如果右侧配置已经是你想保存的版本，可以点击 Apply changes 写回 Agent 配置。",
    context,
    intentSummary: "Continue lightweight Agent Manifest refactor.",
    label: "Apply changes",
    summary: "Apply the current Agent Manifest changes without restarting Quickstart.",
  });
}

export function planAgentBuilderWorkflowTurn(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerOutput {
  const draft = toAgentBuilderWorkflowDraftSnapshot(context.draft.yaml);
  const workflowState = deriveAgentBuilderWorkflowState({
    draft,
    preview: context.preview,
  });

  if (workflowState.activeStageId === "create_agent") {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText:
        "我需要先补齐 Agent type、名称、描述、运行时、模型和系统提示词，才能创建这个 Agent。",
      intentSummary: "Guide the user to complete Quickstart Step 1.",
      plannerRunId: context.plannerRunId,
    });
  }

  if (context.agent.baseConfigApplied) {
    const optionalComponentOutput = planAgentBuilderOptionalComponentRequest(context);

    if (optionalComponentOutput !== null) {
      return optionalComponentOutput;
    }
  }

  if (workflowState.nextAction.kind === "configure_environment") {
    if (
      shouldShowCreateAgentAction({
        context,
        nextAction: workflowState.nextAction,
      })
    ) {
      return createNextActionPlannerOutput({
        assistantText:
          "Step 1 的 Agent 必填字段已经齐全。先点击 Create this agent 保存并初始化这个 Agent，然后继续配置 Environment。",
        context,
        intentSummary: "Ask the user to apply Quickstart Step 1 before Step 2.",
        nextAction: {
          kind: CREATE_AGENT_ACTION_KEY,
          label: "Create this agent",
        },
        summary: "Create or apply the Agent base Manifest before Environment configuration.",
      });
    }

    return createAgentBuilderEnvironmentQuestionPlannerOutput({
      context,
      hasReusableEnvironments: context.assets.currentIndex.environments.length > 0,
    });
  }

  if (workflowState.nextAction.kind === "open_preview") {
    return createNextActionPlannerOutput({
      assistantText:
        "配置已经可以进入 Preview。你可以点击 Test in Chat 复用 preview 会话进行真实测试。",
      context,
      intentSummary: "Guide the user to open Builder Preview.",
      nextAction: workflowState.nextAction,
      summary: "Open Preview and reuse the Builder preview session.",
    });
  }

  return createAgentBuilderPlainTextPlannerOutput({
    assistantText: "我会继续根据当前 Manifest 帮你调整 Agent 配置。",
    intentSummary: "Continue lightweight Agent Manifest refinement.",
    plannerRunId: context.plannerRunId,
  });
}
