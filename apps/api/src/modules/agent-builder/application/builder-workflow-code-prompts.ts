import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";
import {
  AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_ALIASES,
  AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES,
  AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES,
  AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES,
  AGENT_BUILDER_STARTER_PACK_WORKFLOW_STATUS_VALUES,
} from "@mosoo/contracts/agent-builder";

import {
  AGENT_BUILDER_WORKFLOW_INTENT_CLASSES,
  AGENT_BUILDER_WORKFLOW_SOURCE_MODES,
} from "./builder-workflow-code-plan";
import { AGENT_BUILDER_WORKFLOW_CODE_OUTPUT_SCHEMA } from "./builder-workflow-code-schema";
import type { AgentBuilderWorkflowCodeGenerationRequestBody } from "./builder-workflow-code-schema";
import { renderAgentBuilderAssemblyToolDeclarations } from "./builder-workflow-tool-declarations.service";

const MAX_PROMPT_CONTEXT_LENGTH = 28_000;
const DRAFT_PATCH_FIELD_PATH_PROMPT_VALUES = AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES.map(
  (fieldPath) => `"${fieldPath}"`,
).join(", ");
const DRAFT_PATCH_FIELD_PATH_ALIAS_PROMPT_VALUES = Object.keys(
  AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_ALIASES,
)
  .map((fieldPath) => `"${fieldPath}"`)
  .join(", ");
const STARTER_PACK_ASSET_TYPE_PROMPT_VALUES = AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES.map(
  (assetType) => `"${assetType}"`,
).join(" | ");
const STARTER_PACK_STATUS_PROMPT_VALUES = AGENT_BUILDER_STARTER_PACK_WORKFLOW_STATUS_VALUES.map(
  (status) => `"${status}"`,
).join(" | ");
const STARTER_PACK_APPROVAL_MODE_PROMPT_VALUES =
  AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES.map((approvalMode) => `"${approvalMode}"`).join(
    " | ",
  );
const INTENT_CLASS_PROMPT_VALUES = AGENT_BUILDER_WORKFLOW_INTENT_CLASSES.join(", ");
const SOURCE_MODE_PROMPT_VALUES = AGENT_BUILDER_WORKFLOW_SOURCE_MODES.join(", ");

function compactWorkflowContext(context: AgentBuilderPlannerContext): string {
  return JSON.stringify({
    agent: context.agent,
    assets: context.assets,
    boundaryPolicy: context.boundaryPolicy,
    conversation: context.conversation,
    draft: context.draft,
    historicalOpenNodes: context.historicalOpenNodes,
    plannerRunId: context.plannerRunId,
    readiness: context.readiness,
    systemAgent: context.systemAgent,
    threadId: context.threadId,
    turn: context.turn,
    version: context.version,
  }).slice(0, MAX_PROMPT_CONTEXT_LENGTH);
}

function createWorkflowToolPayloadContract(): string {
  return [
    "Tool payload contract:",
    "prepare_draft_patch input must be { changes: [{ fieldPath, value, nodeKey?, summary?, operation? }] } with a non-empty changes array.",
    `prepare_draft_patch fieldPath must be one of: ${DRAFT_PATCH_FIELD_PATH_PROMPT_VALUES}.`,
    `Use canonical fieldPath values only. Do not use Draft YAML paths such as ${DRAFT_PATCH_FIELD_PATH_ALIAS_PROMPT_VALUES}.`,
    'For agent name changes use fieldPath "name"; for system prompt changes use fieldPath "prompt"; for runtime id changes use fieldPath "runtimeId".',
    "Never call prepare_draft_patch with an empty changes array. If there is no Draft change, return needs_config or plain assistantText without a draft_patch item.",
    "After prepare_draft_patch, call dry_run_draft_patch with the prepared output: const prepared = await builder.prepare_draft_patch(...); const dryRun = await builder.dry_run_draft_patch({ nodes: prepared.nodes });",
    "Never call dry_run_draft_patch with an empty object.",
    "For binding existing assets, prefer prepare_bind_space_patch, prepare_bind_environment_patch, prepare_bind_mcp_patch, or prepare_bind_skill_patch instead of generic fieldPath arrays.",
    'resolve_asset_reference input must include assetType: "skill", "mcp", "environment", or "space"; do not use kind instead of assetType.',
  ].join("\n");
}

function createWorkflowIntentPlanningContract(): string {
  return [
    "V2 planner parity - intent and tool-sequence planning:",
    `Before writing code, classify the Builder turn into one intentClass: ${INTENT_CLASS_PROMPT_VALUES}.`,
    `Return that intentClass in the top-level JSON. Also return sourceMode, the planner mode: ${SOURCE_MODE_PROMPT_VALUES}.`,
    "Return toolSequence as the exact ordered builder.* tool ids your code will call. Every builder.* call in code must appear in toolSequence, and every toolSequence id must be called in code.",
    "Generate direct Code Mode tool calls for the chosen intent. Do not return a Starter Pack by simply describing what should happen.",
    "For draft_field_edit: call get_draft_snapshot({}) when the current value matters, then prepare_draft_patch, then dry_run_draft_patch, then return Starter Pack items backed by those tool calls.",
    'For bind_existing_asset: call resolve_asset_reference with bindingState: ["not_bound"], then the relevant prepare_bind_*_patch tool, then dry_run_draft_patch, then return a bind_existing_asset item.',
    "For missing_asset_setup: only return needs_config/open_external_setup after resolve/search proves the asset is missing or the capability is outside Assembly-only creation boundaries.",
    "For already_bound_noop: if resolve_asset_reference reports no_op or alreadyBound, return an applied action none item; do not ask for approval.",
    "For ordinary_question: answer in assistantText with items [] unless a real configuration change is requested.",
    "When the user expresses a recognizable Agent goal, use case, helper, assistant, bot, or copilot request, do not merely create the field that was explicitly named.",
    "Plan a coherent first Draft bundle before choosing assets: name, description, and system prompt are one semantic unit.",
    "For this first Draft bundle, call get_draft_snapshot({}) first, then call prepare_draft_patch once with separate changes for fieldPath name, description, and prompt whenever those fields can be inferred.",
    "Use field-specific node keys such as first_draft_name, first_draft_description, and first_draft_prompt so Starter Pack items can point to each prepared patch.",
    "Then call dry_run_draft_patch({ nodes: prepared.nodes }) before returning any Starter Pack item.",
    "Return separate pending Starter Pack items for Name, Description, and System Prompt. Do not return only a Name item for a new assistant request unless the user explicitly asked only to rename the Draft.",
    "Assistant text may ask one focused follow-up question about sources, scope, output format, cadence, or constraints, but that question must not block the safe first Draft bundle.",
    "If the request needs a real-time data source that is not currently available, still prepare the Draft prompt with an explicit boundary telling the Agent not to fabricate data and return a needs_config item for the missing MCP/Environment only when appropriate.",
    "Example: 用户说“我要一个天气预报小助手” -> prepare name “天气预报小助手”, description for weather-forecast assistance, and a prompt that asks for location/date, uses available weather data sources, and refuses to invent live weather when no data source is configured.",
  ].join("\n");
}

function createWorkflowStarterPackContract(): string {
  return [
    "Starter Pack item shape:",
    `{ nodeKey, assetType: ${STARTER_PACK_ASSET_TYPE_PROMPT_VALUES}, title, reason, status: ${STARTER_PACK_STATUS_PROMPT_VALUES}, approvalMode: ${STARTER_PACK_APPROVAL_MODE_PROMPT_VALUES}, evidenceRefs, action }`,
    "Valid action examples:",
    '{ type: "draft_patch", patchNodeKey: "patch_name" }',
    '{ type: "bind_existing_asset", assetId: "asset_id" }',
    '{ type: "open_external_setup", href: "/environment" }',
    "Canonical setup hrefs:",
    'Environment -> "/environment"',
    'MCP -> "/integrations/mcp"',
    'Skill -> "/integrations/skills"',
    'Space -> "/space"',
    'Provider credentials -> "/providers"',
    'Never use non-routed aliases such as "/mcp", "/skills", "/spaces", or "/environments".',
  ].join("\n");
}

function createWorkflowCodeSystemPrompt(): string {
  return [
    "You write short Cloudflare Code Mode workflow code for Mosoo Agent Builder.",
    'Return only JSON that matches the provided schema: {"intentClass":"...","sourceMode":"...","toolSequence":["..."],"code":"..."}.',
    "The code must be a single async arrow function, for example: async () => { return {...}; }.",
    "Use only the typed builder.* tools declared below. Never use codemode.*, fetch, imports, process, eval, Function, network, filesystem, create, commit, publish, delete, permission, or secret APIs.",
    "First version is Assembly-only: recommend and bind existing visible Skill, MCP, Environment, and Space assets; do not create assets.",
    "If the user input contains a plaintext API key, bearer token, provider key, or secret assignment, return a blocked Starter Pack item that tells the user to use the dedicated Environment, Provider Credential, or MCP configuration page; never call tools for that value.",
    "For every pending draft_patch Starter Pack item, call prepare_draft_patch and dry_run_draft_patch before returning the item.",
    'For every pending bind_existing_asset item, call resolve_asset_reference with bindingState: ["not_bound"], then the relevant prepare_bind_*_patch tool, and dry_run_draft_patch before returning the item.',
    'If resolve_asset_reference returns nextAction "no_op" or alreadyBound true, return an applied item with action { type: "none" }; do not ask the user to approve an asset that is already bound.',
    "If resolve_asset_reference returns status resolved with a resolvedAsset, continue to the relevant prepare_bind_*_patch tool and dry_run_draft_patch; never return needs_config/open_external_setup for that resolved asset.",
    "If an asset is missing, return a needs_config item with approvalMode external_config and an open_external_setup action; do not invent IDs.",
    'Always return an AgentBuilderStarterPackResult object with version: 1, mode: "starter_pack", plannerRunId from context, assistantText, intentSummary, and items.',
    "",
    renderAgentBuilderAssemblyToolDeclarations(),
    "",
    createWorkflowToolPayloadContract(),
    "",
    createWorkflowIntentPlanningContract(),
    "",
    createWorkflowStarterPackContract(),
  ].join("\n");
}

function createWorkflowCodeUserPrompt(context: AgentBuilderPlannerContext): string {
  return [
    "Generate one Assembly-only Code Mode workflow for this Builder turn.",
    "First infer the intent class from Builder context, then emit code that directly executes the matching builder.* tool sequence.",
    "The generated code should be specific to this turn; avoid generic TODO branches or a Starter Pack that is not backed by tool calls.",
    "Use Chinese user-facing assistantText/title/reason when the user input is Chinese.",
    "Builder context JSON:",
    compactWorkflowContext(context),
  ].join("\n");
}

export function createWorkflowCodeGenerationRequestBody(input: {
  correction?: string;
  context: AgentBuilderPlannerContext;
  model: string;
}): AgentBuilderWorkflowCodeGenerationRequestBody {
  return {
    input: [
      {
        content: createWorkflowCodeSystemPrompt(),
        role: "system",
      },
      {
        content: createWorkflowCodeUserPrompt(input.context),
        role: "user",
      },
      ...(input.correction === undefined
        ? []
        : [
            {
              content: input.correction,
              role: "user",
            },
          ]),
    ],
    max_output_tokens: 4_000,
    model: input.model,
    text: {
      format: {
        name: "agent_builder_assembly_workflow_code",
        schema: AGENT_BUILDER_WORKFLOW_CODE_OUTPUT_SCHEMA,
        strict: true,
        type: "json_schema",
      },
    },
  };
}

export function createWorkflowCodeCorrectionPrompt(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown workflow code validation error.";

  return [
    "The previous Code Mode workflow code was rejected before execution.",
    `Validation error: ${message}`,
    "Regenerate the code from the same Builder context.",
    "Do the intent classification first, then return intentClass, sourceMode, toolSequence, and code.",
    "The toolSequence must exactly match the builder.* calls in code.",
    "For first_draft_agent_goal, intentClass must be first_draft_agent_goal, sourceMode must be draft_patch, toolSequence must include get_draft_snapshot, prepare_draft_patch, and dry_run_draft_patch, and the code must prepare name, description, and prompt before returning separate Starter Pack items for those fields.",
  ].join("\n");
}
