import type {
  AgentBuilderAskUserOption,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";

import {
  createAgentBuilderActionPlannerOutput,
  createAgentBuilderPlainTextPlannerOutput,
} from "./agent-builder-planner-output-factory";
import type { AgentBuilderStructuredReplyInput } from "./agent-builder-structured-input";

const ASK_ENVIRONMENT_NODE_KEY = "ask_environment";
const CREATE_ENVIRONMENT_ACTION_KEY = "create_environment";
const CREATE_ENVIRONMENT_OPTION_KEY = "action:create_environment";
const MAX_ENVIRONMENT_OPTIONS = 8;

export function isAgentBuilderEnvironmentStructuredReplyNodeKey(nodeKey: string): boolean {
  return nodeKey === ASK_ENVIRONMENT_NODE_KEY;
}

function createEnvironmentOptionKey(environmentId: string): string {
  return `environment:${environmentId}`;
}

function readEnvironmentIdFromOptionKey(optionKey: string): string | null {
  return optionKey.startsWith("environment:") ? optionKey.slice("environment:".length) : null;
}

function createEnvironmentAskUserOptions(
  context: AgentBuilderPlannerContext,
): AgentBuilderAskUserOption[] {
  const environmentOptions = context.assets.currentIndex.environments
    .slice(0, MAX_ENVIRONMENT_OPTIONS)
    .map((environment) => ({
      description:
        environment.bindingState === "bound"
          ? "Already bound to this draft."
          : "Existing environment",
      label: environment.name,
      optionKey: createEnvironmentOptionKey(environment.id),
      value: environment.id,
    }));

  return [
    ...environmentOptions,
    {
      description: "Open the Environment creation flow before Preview.",
      label: "Create a new Environment",
      optionKey: CREATE_ENVIRONMENT_OPTION_KEY,
      value: "create_environment",
    },
  ];
}

export function createAgentBuilderEnvironmentQuestionPlannerOutput(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly hasReusableEnvironments: boolean;
}): AgentBuilderPlannerOutput {
  const askUser = input.hasReusableEnvironments
    ? {
        allowCustomText: true,
        allowSkip: true,
        mode: "single_select" as const,
        options: createEnvironmentAskUserOptions(input.context),
        prompt: "Would you like to reuse an existing Environment or create a new one?",
        submitLabel: "Continue",
      }
    : {
        allowCustomText: true,
        allowSkip: true,
        mode: "free_text" as const,
        options: [],
        prompt: "No reusable Environment is available. Describe a new Environment or skip for now.",
        submitLabel: "Continue",
      };
  const node: AgentBuilderPlanNode = {
    actions: [],
    askUser,
    kind: "question",
    nodeKey: ASK_ENVIRONMENT_NODE_KEY,
    operation: "ask",
    requiresConfirmation: false,
    status: "pending",
    summary: "Ask the user how to configure the Agent Environment.",
    targetType: "environment",
  };

  return {
    assistantText:
      "The base Agent is complete. The next step is to select, create, or skip an Environment. This choice determines the execution environment where tools run.",
    intentSummary: "Ask the user to configure Quickstart Step 2 Environment.",
    mode: "question",
    nodes: [node],
    plannerRunId: input.context.plannerRunId,
    version: 1,
  };
}

function isCurrentEnvironmentQuestionPending(context: AgentBuilderPlannerContext): boolean {
  const latestOpenNode = context.historicalOpenNodes[0] ?? null;

  return (
    latestOpenNode !== null &&
    latestOpenNode.kind === "question" &&
    latestOpenNode.nodeKey === ASK_ENVIRONMENT_NODE_KEY &&
    latestOpenNode.status === "pending" &&
    latestOpenNode.targetType === "environment"
  );
}

function createEnvironmentDraftPatchPlannerOutput(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly environmentId: string;
  readonly environmentName: string;
}): AgentBuilderPlannerOutput {
  return {
    assistantText: `Environment selected: ${input.environmentName}. I'll bind it to the current Agent Manifest.`,
    intentSummary: "Bind the selected Environment to the Agent draft.",
    mode: "draft_patch",
    nodes: [
      {
        actions: [],
        draftPatch: {
          fieldPath: "environmentId",
          value: input.environmentId,
        },
        kind: "draft_patch",
        nodeKey: "patch_environment",
        operation: "bind",
        requiresConfirmation: false,
        status: "pending",
        summary: `Bind Environment ${input.environmentName}.`,
        targetType: "draft",
      },
    ],
    plannerRunId: input.context.plannerRunId,
    version: 1,
  };
}

function createCreateEnvironmentGuidancePlannerOutput(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerOutput {
  return createAgentBuilderActionPlannerOutput({
    actionKey: CREATE_ENVIRONMENT_ACTION_KEY,
    assistantText:
      "Creating a new Environment requires opening a dedicated secure configuration UI. Runtime scripts, package configuration, and credentials are handled by the Environment configuration surface. Click Create Environment to continue.",
    context,
    intentSummary: "Guide the user to the safe Environment creation UI.",
    label: "Create Environment",
    summary: "Open the secure Environment creation UI and bind the created Environment.",
  });
}

function createSkipEnvironmentDecisionPlannerOutput(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerOutput {
  return {
    assistantText:
      "Got it — skipping the Environment. I'll record this decision in the current Agent Manifest. You can always come back to the Builder to add an Environment later.",
    intentSummary: "Persist the skipped Environment decision in the Agent draft.",
    mode: "draft_patch",
    nodes: [
      {
        actions: [],
        draftPatch: {
          fieldPath: "componentDecisions.environment",
          value: "skipped",
        },
        kind: "draft_patch",
        nodeKey: "patch_environment_decision",
        operation: "update",
        requiresConfirmation: false,
        status: "pending",
        summary: "Record that Environment configuration was skipped.",
        targetType: "draft",
      },
    ],
    plannerRunId: context.plannerRunId,
    version: 1,
  };
}

export function planAgentBuilderEnvironmentStructuredReply(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly reply: AgentBuilderStructuredReplyInput;
}): AgentBuilderPlannerOutput | null {
  if (input.reply.nodeKey !== ASK_ENVIRONMENT_NODE_KEY) {
    return null;
  }

  if (!isCurrentEnvironmentQuestionPending(input.context)) {
    return null;
  }

  if (input.reply.mode !== "single_select" && input.reply.mode !== "free_text") {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText:
        "This structured reply's input mode doesn't belong to the Environment selection flow. Please select again or enter an Environment configuration.",
      intentSummary: "Reject a structured reply mode that does not match the Environment question.",
      plannerRunId: input.context.plannerRunId,
    });
  }

  if (
    (input.reply.mode === "single_select" && input.reply.selectedOptionKeys.length > 1) ||
    (input.reply.mode === "free_text" && input.reply.selectedOptionKeys.length > 0)
  ) {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText:
        "This structured reply doesn't match the current Environment question. Please select an option again or enter a custom description.",
      intentSummary: "Reject a malformed Environment structured reply.",
      plannerRunId: input.context.plannerRunId,
    });
  }

  if (input.reply.skipped) {
    return createSkipEnvironmentDecisionPlannerOutput(input.context);
  }

  const selectedOptionKey = input.reply.selectedOptionKeys[0] ?? null;

  if (selectedOptionKey === CREATE_ENVIRONMENT_OPTION_KEY) {
    return createCreateEnvironmentGuidancePlannerOutput(input.context);
  }

  if (selectedOptionKey === null) {
    if (input.reply.customText !== null) {
      return createCreateEnvironmentGuidancePlannerOutput(input.context);
    }

    return createAgentBuilderEnvironmentQuestionPlannerOutput({
      context: input.context,
      hasReusableEnvironments: input.context.assets.currentIndex.environments.length > 0,
    });
  }

  const selectedEnvironmentId = readEnvironmentIdFromOptionKey(selectedOptionKey);
  const selectedEnvironment =
    selectedEnvironmentId === null
      ? null
      : input.context.assets.currentIndex.environments.find(
          (environment) => environment.id === selectedEnvironmentId,
        );

  if (selectedEnvironment === undefined || selectedEnvironment === null) {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText:
        "This Environment isn't among the currently visible assets. I can't bind resources that aren't visible — please select a visible Environment instead.",
      intentSummary: "Reject an Environment selection that is not visible in planner context.",
      plannerRunId: input.context.plannerRunId,
    });
  }

  return createEnvironmentDraftPatchPlannerOutput({
    context: input.context,
    environmentId: selectedEnvironment.id,
    environmentName: selectedEnvironment.name,
  });
}
