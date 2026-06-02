import { AGENT_BUILDER_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolId,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderWorkflowPlannerCodePlan } from "./builder-workflow-code-plan";
import { listAgentBuilderWorkflowToolDescriptors } from "./builder-workflow-tool-descriptor.service";

const MAX_WORKFLOW_CODE_LENGTH = 16_000;
const FORBIDDEN_WORKFLOW_CODE_PATTERNS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "connect(",
  "import ",
  "import(",
  "require(",
  "eval(",
  "Function(",
  "process.",
  "Bun.",
  "Deno.",
  "codemode.",
  "write_secret",
  "publish_agent",
  "delete_",
  "change_permission",
] as const;
const FIRST_DRAFT_AGENT_GOAL_TOKENS = [
  "agent",
  "assistant",
  "bot",
  "copilot",
  "助手",
  "小助手",
  "助理",
  "机器人",
] as const;
const FIRST_DRAFT_AGENT_GOAL_ACTION_TOKENS = [
  "我要",
  "我想要",
  "我需要",
  "帮我做",
  "帮我创建",
  "创建",
  "新建",
  "做一个",
  "做个",
  "改成",
  "变成",
  "设成",
  "build",
  "create",
  "make",
] as const;
const COHERENT_FIRST_DRAFT_FIELD_PATHS = ["name", "description", "prompt"] as const;
const PREPARE_BIND_TOOL_IDS = [
  "prepare_bind_environment_patch",
  "prepare_bind_mcp_patch",
  "prepare_bind_skill_patch",
  "prepare_bind_space_patch",
] as const satisfies readonly AgentBuilderToolId[];
const AGENT_BUILDER_TOOL_IDS = new Set<string>(AGENT_BUILDER_TOOL_ID_VALUES);
const BUILDER_DOT_TOOL_CALL_PATTERN = /\bbuilder\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu;
const BUILDER_BRACKET_ACCESS_PATTERN = /\bbuilder\s*\[/u;

function normalizeIntentText(value: string): string {
  return value.trim().toLowerCase();
}

function isNarrowRenameOnlyIntent(inputText: string): boolean {
  const normalized = normalizeIntentText(inputText);
  const mentionsRename =
    normalized.includes("rename") ||
    normalized.includes("改名") ||
    normalized.includes("名字") ||
    normalized.includes("名称");
  const mentionsOtherCoreDraftField =
    normalized.includes("description") ||
    normalized.includes("描述") ||
    normalized.includes("prompt") ||
    normalized.includes("system prompt") ||
    normalized.includes("提示词") ||
    normalized.includes("系统提示");

  return mentionsRename && !mentionsOtherCoreDraftField;
}

function isLikelyFirstDraftAgentGoal(context: AgentBuilderPlannerContext | undefined): boolean {
  if (context === undefined) {
    return false;
  }

  const inputText = context.turn.inputText.trim();

  if (inputText.length === 0 || isNarrowRenameOnlyIntent(inputText)) {
    return false;
  }

  const normalized = normalizeIntentText(inputText);
  const hasAgentGoalToken = FIRST_DRAFT_AGENT_GOAL_TOKENS.some((token) =>
    normalized.includes(token),
  );
  const hasActionToken = FIRST_DRAFT_AGENT_GOAL_ACTION_TOKENS.some((token) =>
    normalized.includes(token),
  );

  return hasAgentGoalToken && hasActionToken;
}

function codeContainsObjectStringProperty(input: {
  code: string;
  propertyName: string;
  value: string;
}): boolean {
  const propertyPattern = `(?:${input.propertyName}|["'\`]${input.propertyName}["'\`])`;
  const valuePattern = `["'\`]${input.value}["'\`]`;
  const pattern = new RegExp(`${propertyPattern}\\s*:\\s*${valuePattern}`, "u");

  return pattern.test(input.code);
}

function isAgentBuilderToolId(value: string): value is AgentBuilderToolId {
  return AGENT_BUILDER_TOOL_IDS.has(value);
}

function listWorkflowToolCallNames(code: string): string[] {
  return [...code.matchAll(BUILDER_DOT_TOOL_CALL_PATTERN)]
    .map((match) => match[1])
    .filter((toolName): toolName is string => toolName !== undefined);
}

function listWorkflowToolCalls(code: string): AgentBuilderToolId[] {
  return listWorkflowToolCallNames(code).filter(isAgentBuilderToolId);
}

function listUnknownWorkflowToolCalls(code: string): string[] {
  return listWorkflowToolCallNames(code).filter((toolName) => !isAgentBuilderToolId(toolName));
}

function codeContainsToolCall(code: string, toolId: AgentBuilderToolId): boolean {
  return listWorkflowToolCalls(code).includes(toolId);
}

function codeContainsAnyToolCall(code: string, toolIds: readonly AgentBuilderToolId[]): boolean {
  return toolIds.some((toolId) => codeContainsToolCall(code, toolId));
}

export function validateAgentBuilderAssemblyWorkflowCode(
  code: string,
  context?: AgentBuilderPlannerContext,
): string[] {
  const errors: string[] = [];
  const trimmed = code.trim();

  if (trimmed.length === 0) {
    errors.push("code is empty.");
  }

  if (trimmed.length > MAX_WORKFLOW_CODE_LENGTH) {
    errors.push(`code exceeds ${MAX_WORKFLOW_CODE_LENGTH} characters.`);
  }

  if (!trimmed.startsWith("async") || !trimmed.includes("=>")) {
    errors.push("code must be a single async arrow function.");
  }

  if (!trimmed.includes("starter_pack")) {
    errors.push("code must return a Starter Pack result.");
  }

  const returnsDraftPatchAction = codeContainsObjectStringProperty({
    code: trimmed,
    propertyName: "type",
    value: "draft_patch",
  });

  if (returnsDraftPatchAction && !codeContainsToolCall(trimmed, "prepare_draft_patch")) {
    errors.push("draft_patch Starter Pack code must call builder.prepare_draft_patch first.");
  }

  if (returnsDraftPatchAction && !codeContainsToolCall(trimmed, "dry_run_draft_patch")) {
    errors.push("draft_patch Starter Pack code must call builder.dry_run_draft_patch first.");
  }

  if (isLikelyFirstDraftAgentGoal(context)) {
    if (!codeContainsToolCall(trimmed, "get_draft_snapshot")) {
      errors.push("first-draft Agent goal code must call builder.get_draft_snapshot.");
    }

    for (const fieldPath of COHERENT_FIRST_DRAFT_FIELD_PATHS) {
      if (
        !codeContainsObjectStringProperty({
          code: trimmed,
          propertyName: "fieldPath",
          value: fieldPath,
        })
      ) {
        errors.push(`first-draft Agent goal code must prepare ${fieldPath}.`);
      }
    }
  }

  for (const pattern of FORBIDDEN_WORKFLOW_CODE_PATTERNS) {
    if (trimmed.includes(pattern)) {
      errors.push(`code contains forbidden pattern ${pattern}.`);
    }
  }

  if (BUILDER_BRACKET_ACCESS_PATTERN.test(trimmed)) {
    errors.push("code must call builder tools with direct dot notation.");
  }

  for (const toolName of listUnknownWorkflowToolCalls(trimmed)) {
    errors.push(`code calls unknown builder tool ${toolName}.`);
  }

  for (const descriptor of listAgentBuilderWorkflowToolDescriptors()) {
    if (descriptor.builderAssembly === "included") {
      continue;
    }

    if (codeContainsToolCall(trimmed, descriptor.toolId)) {
      errors.push(`code calls excluded tool ${descriptor.toolId}.`);
    }
  }

  return errors;
}

function requirePlannedTool(input: {
  errors: string[];
  plan: AgentBuilderWorkflowPlannerCodePlan;
  toolId: AgentBuilderToolId;
}): void {
  if (!input.plan.toolSequence.includes(input.toolId)) {
    input.errors.push(`${input.plan.intentClass} workflow plan must include ${input.toolId}.`);
  }
}

function requireAnyPlannedTool(input: {
  errors: string[];
  label: string;
  plan: AgentBuilderWorkflowPlannerCodePlan;
  toolIds: readonly AgentBuilderToolId[];
}): void {
  if (!input.toolIds.some((toolId) => input.plan.toolSequence.includes(toolId))) {
    input.errors.push(`${input.plan.intentClass} workflow plan must include ${input.label}.`);
  }
}

function requireSourceMode(input: {
  errors: string[];
  plan: AgentBuilderWorkflowPlannerCodePlan;
  sourceMode: AgentBuilderWorkflowPlannerCodePlan["sourceMode"];
}): void {
  if (input.plan.sourceMode !== input.sourceMode) {
    input.errors.push(
      `${input.plan.intentClass} workflow plan must use sourceMode ${input.sourceMode}.`,
    );
  }
}

function requireOneOfSourceModes(input: {
  errors: string[];
  plan: AgentBuilderWorkflowPlannerCodePlan;
  sourceModes: readonly AgentBuilderWorkflowPlannerCodePlan["sourceMode"][];
}): void {
  if (!input.sourceModes.includes(input.plan.sourceMode)) {
    input.errors.push(
      `${input.plan.intentClass} workflow plan must use one of sourceMode ${input.sourceModes.join(
        ", ",
      )}.`,
    );
  }
}

export function validateAgentBuilderAssemblyWorkflowPlan(
  plan: AgentBuilderWorkflowPlannerCodePlan,
  context?: AgentBuilderPlannerContext,
): string[] {
  const errors = validateAgentBuilderAssemblyWorkflowCode(plan.code, context);
  const plannedTools = new Set<AgentBuilderToolId>(plan.toolSequence);
  const calledTools = listWorkflowToolCalls(plan.code);

  for (const descriptor of listAgentBuilderWorkflowToolDescriptors()) {
    if (descriptor.builderAssembly === "excluded" && plannedTools.has(descriptor.toolId)) {
      errors.push(`workflow plan includes excluded tool ${descriptor.toolId}.`);
    }
  }

  for (const toolId of plan.toolSequence) {
    if (!codeContainsToolCall(plan.code, toolId)) {
      errors.push(`workflow plan lists ${toolId} but code does not call builder.${toolId}.`);
    }
  }

  for (const toolId of AGENT_BUILDER_TOOL_ID_VALUES) {
    if (codeContainsToolCall(plan.code, toolId) && !plannedTools.has(toolId)) {
      errors.push(`code calls builder.${toolId} but toolSequence omits ${toolId}.`);
    }
  }

  if (
    calledTools.length !== plan.toolSequence.length ||
    calledTools.some((toolId, index) => toolId !== plan.toolSequence[index])
  ) {
    errors.push(
      `workflow plan toolSequence must exactly match code tool calls: ${calledTools.join(", ")}.`,
    );
  }

  if (isLikelyFirstDraftAgentGoal(context) && plan.intentClass !== "first_draft_agent_goal") {
    errors.push("recognizable first-draft Agent goal must use intentClass first_draft_agent_goal.");
  }

  if (plan.intentClass === "first_draft_agent_goal") {
    requireSourceMode({ errors, plan, sourceMode: "draft_patch" });
    requirePlannedTool({ errors, plan, toolId: "get_draft_snapshot" });
    requirePlannedTool({ errors, plan, toolId: "prepare_draft_patch" });
    requirePlannedTool({ errors, plan, toolId: "dry_run_draft_patch" });
  }

  if (plan.intentClass === "draft_field_edit") {
    requireSourceMode({ errors, plan, sourceMode: "draft_patch" });
    requirePlannedTool({ errors, plan, toolId: "prepare_draft_patch" });
    requirePlannedTool({ errors, plan, toolId: "dry_run_draft_patch" });
  }

  if (plan.intentClass === "bind_existing_asset") {
    requireSourceMode({ errors, plan, sourceMode: "draft_patch" });
    requirePlannedTool({ errors, plan, toolId: "resolve_asset_reference" });
    requireAnyPlannedTool({
      errors,
      label: "a prepare_bind_*_patch tool",
      plan,
      toolIds: PREPARE_BIND_TOOL_IDS,
    });
    requirePlannedTool({ errors, plan, toolId: "dry_run_draft_patch" });
  }

  if (plan.intentClass === "missing_asset_setup") {
    requireOneOfSourceModes({ errors, plan, sourceModes: ["blocked", "question"] });
    requireAnyPlannedTool({
      errors,
      label: "search_assets or resolve_asset_reference",
      plan,
      toolIds: ["search_assets", "resolve_asset_reference"],
    });
  }

  if (plan.intentClass === "already_bound_noop") {
    requireSourceMode({ errors, plan, sourceMode: "plain_text" });
    requirePlannedTool({ errors, plan, toolId: "resolve_asset_reference" });

    if (
      codeContainsAnyToolCall(plan.code, [
        "dry_run_draft_patch",
        "prepare_bind_environment_patch",
        "prepare_bind_mcp_patch",
        "prepare_bind_skill_patch",
        "prepare_bind_space_patch",
      ])
    ) {
      errors.push("already_bound_noop workflow plan must not prepare or dry-run Draft changes.");
    }
  }

  if (plan.intentClass === "ordinary_question") {
    requireSourceMode({ errors, plan, sourceMode: "plain_text" });

    if (
      codeContainsAnyToolCall(plan.code, [
        "dry_run_draft_patch",
        "prepare_draft_patch",
        "prepare_bind_environment_patch",
        "prepare_bind_mcp_patch",
        "prepare_bind_skill_patch",
        "prepare_bind_space_patch",
        "prepare_replace_skill_patch",
      ])
    ) {
      errors.push("ordinary_question workflow plan must not prepare or dry-run Draft changes.");
    }
  }

  if (plan.intentClass === "unsupported_or_blocked") {
    requireSourceMode({ errors, plan, sourceMode: "blocked" });
  }

  const returnsBindExistingAssetAction = codeContainsObjectStringProperty({
    code: plan.code,
    propertyName: "type",
    value: "bind_existing_asset",
  });

  if (returnsBindExistingAssetAction) {
    requirePlannedTool({ errors, plan, toolId: "resolve_asset_reference" });
    requireAnyPlannedTool({
      errors,
      label: "a prepare_bind_*_patch tool",
      plan,
      toolIds: PREPARE_BIND_TOOL_IDS,
    });
    requirePlannedTool({ errors, plan, toolId: "dry_run_draft_patch" });
  }

  return errors;
}
