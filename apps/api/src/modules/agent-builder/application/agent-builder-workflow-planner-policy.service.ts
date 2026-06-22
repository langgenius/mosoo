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
      "I'll treat the current Agent as an existing Manifest and help you refactor it: you can keep editing the name, description, model, and system prompt, or adjust the Environment, Skill, and MCP bindings. I won't walk you through the Quickstart initialization steps again. If the configuration on the right is already the version you want to save, click Apply changes to write it back to the Agent configuration.",
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
        "I need the Agent type, name, description, runtime, model, and system prompt filled in before I can create this Agent.",
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
          "All required Agent fields for Step 1 are complete. Click Create this agent first to save and initialize this Agent, then continue configuring the Environment.",
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
        "The configuration is ready for Preview. You can click Test in Chat to reuse the preview session for real testing.",
      context,
      intentSummary: "Guide the user to open Builder Preview.",
      nextAction: workflowState.nextAction,
      summary: "Open Preview and reuse the Builder preview session.",
    });
  }

  return createAgentBuilderPlainTextPlannerOutput({
    assistantText:
      "I'll keep helping you adjust the Agent configuration based on the current Manifest.",
    intentSummary: "Continue lightweight Agent Manifest refinement.",
    plannerRunId: context.plannerRunId,
  });
}
