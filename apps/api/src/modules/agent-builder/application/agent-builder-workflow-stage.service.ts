import type {
  AgentBuilderComponentChecklistItem,
  AgentBuilderNextAction,
  AgentBuilderPreviewStageSnapshot,
  AgentBuilderWorkflowStageId,
  AgentBuilderWorkflowStageStatus,
  AgentBuilderWorkflowState,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderWorkflowDraftSnapshot } from "./agent-builder-lightweight-draft-types";

interface AgentBuilderWorkflowStateInput {
  readonly draft: AgentBuilderWorkflowDraftSnapshot;
  readonly preview: AgentBuilderPreviewStageSnapshot;
}

interface RequiredCreateAgentField {
  readonly key: string;
  readonly value: string | null;
}

const OPTIONAL_COMPONENT_ITEMS = [
  "skills",
  "mcp_servers",
] as const satisfies readonly AgentBuilderComponentChecklistItem[];

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function listMissingCreateAgentFields(draft: AgentBuilderWorkflowDraftSnapshot): readonly string[] {
  if (draft.parseStatus === "failed") {
    return ["manifest"];
  }

  const fields = [
    { key: "kind", value: draft.kind },
    { key: "name", value: draft.name },
    { key: "description", value: draft.description },
    { key: "runtimeId", value: draft.runtimeId },
    { key: "provider", value: draft.provider },
    { key: "model", value: draft.model },
    { key: "prompt", value: draft.prompt },
  ] as const satisfies readonly RequiredCreateAgentField[];

  return fields.filter((field) => !hasText(field.value)).map((field) => field.key);
}

function hasEnvironmentDecision(draft: AgentBuilderWorkflowDraftSnapshot): boolean {
  return (
    draft.environmentId !== null ||
    draft.componentDecisions.environment === "bound" ||
    draft.componentDecisions.environment === "created" ||
    draft.componentDecisions.environment === "skipped"
  );
}

function statusForStage(
  stageId: AgentBuilderWorkflowStageId,
  activeStageId: AgentBuilderWorkflowStageId,
  completed: boolean,
): AgentBuilderWorkflowStageStatus {
  if (stageId === activeStageId) {
    return "active";
  }

  if (completed) {
    return "completed";
  }

  return "pending";
}

function createNextAction(input: {
  readonly baseComplete: boolean;
  readonly componentsComplete: boolean;
  readonly previewOpened: boolean;
}): AgentBuilderNextAction {
  if (!input.baseComplete) {
    return { kind: "create_agent", label: "Create this agent" };
  }

  if (!input.componentsComplete) {
    return { kind: "configure_environment", label: "Configure environment" };
  }

  if (!input.previewOpened) {
    return { kind: "open_preview", label: "Test in Chat" };
  }

  return { kind: "keep_refining", label: "Keep refining" };
}

export function deriveAgentBuilderWorkflowState(
  input: AgentBuilderWorkflowStateInput,
): AgentBuilderWorkflowState {
  const missingCreateAgentFields = listMissingCreateAgentFields(input.draft);
  const baseComplete = missingCreateAgentFields.length === 0;
  const blockingMissingItems: readonly AgentBuilderComponentChecklistItem[] =
    baseComplete && !hasEnvironmentDecision(input.draft) ? ["environment"] : [];
  const componentsComplete = baseComplete && blockingMissingItems.length === 0;
  const previewSessionStarted = input.preview.sessionExists && input.preview.messageCount > 0;
  const activeStageId: AgentBuilderWorkflowStageId = !baseComplete
    ? "create_agent"
    : !componentsComplete
      ? "configure_components"
      : previewSessionStarted
        ? "refine"
        : input.preview.opened
          ? "preview"
          : "configure_components";

  return {
    activeStageId,
    nextAction: createNextAction({
      baseComplete,
      componentsComplete,
      previewOpened: input.preview.opened,
    }),
    steps: {
      configureComponents: {
        blockingMissingItems,
        optionalItems: OPTIONAL_COMPONENT_ITEMS,
        status: statusForStage("configure_components", activeStageId, componentsComplete),
      },
      createAgent: {
        missingFields: missingCreateAgentFields,
        status: statusForStage("create_agent", activeStageId, baseComplete),
      },
      preview: {
        sessionStarted: previewSessionStarted,
        status: statusForStage("preview", activeStageId, previewSessionStarted),
      },
      refine: {
        status: statusForStage("refine", activeStageId, false),
      },
    },
  };
}
