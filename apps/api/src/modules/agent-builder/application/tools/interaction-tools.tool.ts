import type {
  AgentBuilderPlanNodeAction,
  AgentBuilderPlanNodeActionStyle,
  AgentBuilderPlanNodeTargetType,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";

interface InteractionToolOptions {
  context: AgentBuilderPlannerContext;
}

interface AskUserChoice {
  readonly actionKey: string;
  readonly assetId: string | null;
  readonly label: string;
  readonly style: AgentBuilderPlanNodeActionStyle;
  readonly targetType: AgentBuilderPlanNodeTargetType | null;
  readonly value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlanNodeTargetType(value: string): value is AgentBuilderPlanNodeTargetType {
  return (
    value === "channel" ||
    value === "draft" ||
    value === "environment" ||
    value === "mcp" ||
    value === "skill" ||
    value === "space"
  );
}

function isActionStyle(value: string): value is AgentBuilderPlanNodeActionStyle {
  return value === "danger" || value === "primary" || value === "secondary";
}

function readRequiredString(input: AgentBuilderToolPayload, fieldName: string): string {
  const value = input[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function readOptionalString(input: AgentBuilderToolPayload, fieldName: string): string | null {
  const value = input[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readOptionalBoolean(
  input: AgentBuilderToolPayload,
  fieldName: string,
  defaultValue: boolean,
): boolean {
  const value = input[fieldName];

  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function readTargetType(value: unknown, defaultValue: AgentBuilderPlanNodeTargetType) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value !== "string") {
    throw new Error("targetType is unsupported.");
  }

  const targetType = value.trim();

  if (targetType.length === 0) {
    return defaultValue;
  }

  if (!isPlanNodeTargetType(targetType)) {
    throw new Error("targetType is unsupported.");
  }

  return targetType;
}

function readActionStyle(value: unknown): AgentBuilderPlanNodeActionStyle {
  if (value === undefined || value === null || value === "") {
    return "secondary";
  }

  if (typeof value !== "string") {
    throw new Error("choice.style is unsupported.");
  }

  const style = value.trim();

  if (style.length === 0) {
    return "secondary";
  }

  if (!isActionStyle(style)) {
    throw new Error("choice.style is unsupported.");
  }

  return style;
}

function createActionKey(value: string, index: number): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  const suffix = `_${index + 1}`;
  const base = slug.length > 0 ? slug : "choice";

  return `${base.slice(0, 80 - suffix.length)}${suffix}`;
}

function readChoice(rawChoice: unknown, index: number): AskUserChoice {
  if (!isRecord(rawChoice)) {
    throw new Error(`choices.${index} must be an object.`);
  }

  const label = rawChoice["label"];
  const rawValue = rawChoice["value"];
  const rawActionKey = rawChoice["actionKey"];
  const rawAssetId = rawChoice["assetId"];
  const rawTargetType = rawChoice["targetType"];

  if (typeof label !== "string" || label.trim().length === 0) {
    throw new Error(`choices.${index}.label is required.`);
  }

  const value =
    typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : label.trim();
  const actionKey =
    typeof rawActionKey === "string" && rawActionKey.trim().length > 0
      ? rawActionKey.trim()
      : createActionKey(value, index);
  const assetId =
    rawAssetId === undefined || rawAssetId === null
      ? null
      : typeof rawAssetId === "string" && rawAssetId.trim().length > 0
        ? rawAssetId.trim()
        : null;
  const targetType =
    rawTargetType === undefined || rawTargetType === null
      ? null
      : readTargetType(rawTargetType, "draft");

  if (
    rawAssetId !== undefined &&
    rawAssetId !== null &&
    (typeof rawAssetId !== "string" || rawAssetId.trim().length > 0) &&
    assetId === null
  ) {
    throw new Error(`choices.${index}.assetId must be a string.`);
  }

  return {
    actionKey,
    assetId,
    label: label.trim(),
    style: readActionStyle(rawChoice["style"]),
    targetType,
    value,
  };
}

function readChoices(input: AgentBuilderToolPayload): AskUserChoice[] {
  const choices = input["choices"];

  if (choices === undefined || choices === null) {
    return [];
  }

  if (!Array.isArray(choices)) {
    throw new Error("choices must be an array.");
  }

  return choices.map(readChoice);
}

function validatePlannerOutput(output: AgentBuilderPlannerOutput): AgentBuilderPlannerOutput {
  const parsed = parseAgentBuilderPlannerOutput(output);

  if (parsed === null) {
    throw new Error("Agent Builder interaction tool produced invalid planner output.");
  }

  return parsed;
}

function createToolOutput(output: AgentBuilderPlannerOutput, extra: AgentBuilderToolPayload) {
  return {
    assistantText: output.assistantText,
    intentSummary: output.intentSummary,
    itemCount: output.nodes.length,
    mode: output.mode,
    nodes: output.nodes,
    plannerRunId: output.plannerRunId,
    status: "ready",
    version: output.version,
    ...extra,
  };
}

function toPlanNodeActions(choices: readonly AskUserChoice[]): AgentBuilderPlanNodeAction[] {
  return choices.map((choice) => ({
    actionKey: choice.actionKey,
    label: choice.label,
    style: choice.style,
  }));
}

export function createAskUserTool(options: InteractionToolOptions): AgentBuilderToolDefinition {
  return {
    execute(input) {
      const question = readRequiredString(input, "question");
      const choices = readChoices(input);
      const allowFreeText = readOptionalBoolean(input, "allowFreeText", true);
      const targetType = readTargetType(input["targetType"], "draft");
      const summary = readOptionalString(input, "summary") ?? question;
      const nodeKey = readOptionalString(input, "nodeKey") ?? "ask_user";
      const reason = readOptionalString(input, "reason");
      const output = validatePlannerOutput({
        assistantText: question,
        intentSummary: summary,
        mode: "question",
        nodes: [
          {
            actions: toPlanNodeActions(choices),
            kind: "question",
            nodeKey,
            operation: "ask",
            requiresConfirmation: false,
            status: "pending",
            summary,
            targetType,
          },
        ],
        plannerRunId: options.context.plannerRunId,
        version: 1,
      });

      return createToolOutput(output, {
        allowFreeText,
        choiceCount: choices.length,
        choices: choices.map((choice) => ({
          actionKey: choice.actionKey,
          assetId: choice.assetId,
          label: choice.label,
          targetType: choice.targetType,
          value: choice.value,
        })),
        ...(reason === null ? {} : { reason }),
        question,
      });
    },
    summarizeInput(input) {
      const question = typeof input["question"] === "string" ? input["question"].trim() : "";
      const choices = Array.isArray(input["choices"]) ? input["choices"].length : 0;
      return `{question:string(${question.length}),choices:${choices}}`;
    },
    toolId: "ask_user",
  };
}

export function createReturnBlockedTool(
  options: InteractionToolOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      const message = readRequiredString(input, "message");
      const reasonCode = readOptionalString(input, "reasonCode") ?? "blocked";
      const summary = readOptionalString(input, "summary") ?? message;
      const targetType = readTargetType(input["targetType"], "draft");
      const nodeKey = readOptionalString(input, "nodeKey") ?? `return_blocked_${reasonCode}`;
      const nextSteps = input["nextSteps"];

      if (
        nextSteps !== undefined &&
        nextSteps !== null &&
        (!Array.isArray(nextSteps) || !nextSteps.every((entry) => typeof entry === "string"))
      ) {
        throw new Error("nextSteps must be a string array.");
      }

      const output = validatePlannerOutput({
        assistantText: message,
        intentSummary: summary,
        mode: "blocked",
        nodes: [
          {
            actions: [],
            kind: "blocked",
            nodeKey,
            operation: "blocked",
            requiresConfirmation: false,
            status: "blocked",
            summary,
            targetType,
          },
        ],
        plannerRunId: options.context.plannerRunId,
        version: 1,
      });

      return createToolOutput(output, {
        message,
        nextSteps: Array.isArray(nextSteps) ? nextSteps : [],
        reasonCode,
      });
    },
    summarizeInput(input) {
      const message = typeof input["message"] === "string" ? input["message"].trim() : "";
      const reasonCode =
        typeof input["reasonCode"] === "string" ? input["reasonCode"].trim() : "blocked";
      return `{reasonCode:${reasonCode},message:string(${message.length})}`;
    },
    toolId: "return_blocked",
  };
}
