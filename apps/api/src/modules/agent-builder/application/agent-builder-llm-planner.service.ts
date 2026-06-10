import type { AgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";
import {
  AGENT_BUILDER_ASK_USER_MODE_VALUES,
  AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES,
  AGENT_BUILDER_DRAFT_PATCH_REFERENCE_TARGET_TYPE_VALUES,
  AGENT_BUILDER_DRAFT_PATCH_SECTION_ID_VALUES,
  AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES,
  AGENT_BUILDER_PLAN_NODE_OPERATION_VALUES,
  AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES,
  AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES,
  parseAgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";
import { MCP_AUTH_TYPES } from "@mosoo/contracts/mcp";
import {
  SYSTEM_AGENT_RUNTIME_ID,
  getRuntimeCatalogEntry,
  getRuntimeCatalogVendorForProvider,
} from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { resolveProviderFetchProxy } from "../../vendor-credentials/application/provider-fetch-proxy";
import {
  fetchVendorProbe,
  readVendorProbeErrorCode,
  toVendorProbeAuthHeaders,
  toVendorProbeEndpointUrl,
  validateVendorProbeBaseUrl,
} from "../../vendor-credentials/application/vendor-credential-probe";
import { resolveVendorApiKey } from "../../vendor-credentials/application/vendor-credential.secret-resolution";
import { listAgentBuilderControlPlaneToolDescriptors } from "./agent-builder-control-plane-tool-descriptor.service";
import type {
  AgentBuilderLightweightPlanner,
  AgentBuilderLightweightPlannerInput,
} from "./agent-builder-planner-turn.service";
import { reportAgentBuilderProgress } from "./agent-builder-progress.service";

const AGENT_BUILDER_LLM_PLANNER_TIMEOUT_MS = 45_000;

const AGENT_BUILDER_LLM_PLANNER_SYSTEM_PROMPT = [
  "You are Mosoo Agent Builder, an internal control-plane System Agent.",
  "Your job is to edit exactly one Agent Manifest draft through structured planner output.",
  "Return exactly one JSON object matching the provided AgentBuilderPlannerOutput JSON schema. Do not wrap it in Markdown.",
  "Do not return older shapes such as step/changes/explanation. Do not include plannerRunId; the server injects it.",
  "",
  "Editable Manifest fields:",
  "- kind: pet or cattle.",
  "- name and description.",
  "- runtimeId, provider, model.",
  "- prompt.",
  "- existing skillIds, mcpServerIds, spaceIds, and environmentId.",
  "- componentDecisions.environment can be bound, created, or skipped.",
  "- componentDecisions.agentType records that the kind choice happened (set automatically when kind is patched).",
  "",
  "Workflow (soft guidance for draft Agents — stages order the conversation, never block the user):",
  "Stage 1 identity: settle name, description, runtimeId, provider, and model first.",
  "Stage 2 agent type: ask one single_select question to choose kind — pet (always-on assistant teammate) or cattle (on-demand task worker) — then patch kind with the answer.",
  "Stage 3 assembly: make the Environment decision (bind, create, or skip), then add optional Skills, MCP servers, and Spaces.",
  "Recommend Preview (Test in Chat) once the three stages are settled, but the user may skip ahead or test at any time; treat incomplete stages as suggestions, not gates.",
  "Published Agents are refactor targets; never restart Quickstart for a published Agent.",
  "",
  "Control-plane rules:",
  "- Do not configure channels.",
  "- Do not write credentials into planner output, Manifest text, or YAML.",
  "- To create an Environment, emit a create_environment action with createEnvironmentPayload (name, optional description). Never put env var values, secrets, or setup scripts in the payload; users configure those later in the Environment UI.",
  "- To create a remote MCP server record, emit a create_remote_mcp_server action with createRemoteMcpServerPayload (name, https url, authType oauth or bearer, optional description). Credentials are always connected by the user in the secure UI afterwards; never ask the user to paste tokens into chat.",
  "- If the user is unclear, ask a focused question with askUser.",
  "- If required data is present, prefer a small draft_patch or action over long explanation.",
  "- Treat the current Manifest draft as the source of truth. Manual form edits win when they appear in the current draft.",
  "- Use only visible asset ids from plannerContext.assets.currentIndex when binding existing components.",
] as const;

function stringEnumSchema(values: readonly string[]): Record<string, unknown> {
  return { enum: [...values], type: "string" };
}

function nullableStringSchema(): Record<string, unknown> {
  return { type: ["string", "null"] };
}

function nullableObjectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    anyOf: [
      {
        additionalProperties: false,
        properties,
        required: Object.keys(properties),
        type: "object",
      },
      { type: "null" },
    ],
  };
}

function createAgentBuilderPlannerResponseFormat(): Record<string, unknown> {
  const actionSchema = {
    additionalProperties: false,
    properties: {
      actionKey: stringEnumSchema(AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES),
      createEnvironmentPayload: nullableObjectSchema({
        description: nullableStringSchema(),
        name: { type: "string" },
      }),
      createRemoteMcpServerPayload: nullableObjectSchema({
        authType: stringEnumSchema(MCP_AUTH_TYPES),
        description: nullableStringSchema(),
        name: { type: "string" },
        url: { type: "string" },
      }),
      label: { type: "string" },
      style: stringEnumSchema(["danger", "primary", "secondary"]),
    },
    required: [
      "actionKey",
      "createEnvironmentPayload",
      "createRemoteMcpServerPayload",
      "label",
      "style",
    ],
    type: "object",
  };
  const askUserOptionSchema = {
    additionalProperties: false,
    properties: {
      description: nullableStringSchema(),
      label: { type: "string" },
      optionKey: { type: "string" },
      value: nullableStringSchema(),
    },
    required: ["description", "label", "optionKey", "value"],
    type: "object",
  };
  const askUserSchema = nullableObjectSchema({
    allowCustomText: { type: "boolean" },
    allowSkip: { type: "boolean" },
    mode: stringEnumSchema(AGENT_BUILDER_ASK_USER_MODE_VALUES),
    options: {
      items: askUserOptionSchema,
      type: "array",
    },
    prompt: { type: "string" },
    submitLabel: nullableStringSchema(),
  });
  const draftPatchValueSchema = {
    anyOf: [
      { type: "null" },
      { type: "string" },
      {
        items: { type: "string" },
        type: "array",
      },
    ],
  };
  const draftPatchReferenceSchema = {
    additionalProperties: false,
    properties: {
      bindingState: stringEnumSchema(AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES),
      filename: nullableStringSchema(),
      id: { type: "string" },
      name: { type: "string" },
      targetType: stringEnumSchema(AGENT_BUILDER_DRAFT_PATCH_REFERENCE_TARGET_TYPE_VALUES),
      url: nullableStringSchema(),
    },
    required: ["bindingState", "filename", "id", "name", "targetType", "url"],
    type: "object",
  };
  const draftPatchSchema = nullableObjectSchema({
    autoApply: { type: ["boolean", "null"] },
    baseDraftRevision: nullableStringSchema(),
    baseValue: draftPatchValueSchema,
    fieldPath: stringEnumSchema(AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES),
    resolvedReferences: {
      items: draftPatchReferenceSchema,
      type: "array",
    },
    sectionId: {
      enum: [...AGENT_BUILDER_DRAFT_PATCH_SECTION_ID_VALUES, null],
      type: ["string", "null"],
    },
    value: draftPatchValueSchema,
  });
  const nodeSchema = {
    additionalProperties: false,
    properties: {
      actions: {
        items: actionSchema,
        type: "array",
      },
      askUser: askUserSchema,
      draftPatch: draftPatchSchema,
      fieldPath: nullableStringSchema(),
      kind: stringEnumSchema(["action", "blocked", "draft_patch", "question"]),
      nodeKey: { type: "string" },
      operation: stringEnumSchema(AGENT_BUILDER_PLAN_NODE_OPERATION_VALUES),
      requiresConfirmation: { type: "boolean" },
      status: stringEnumSchema(["applied", "blocked", "failed", "pending"]),
      summary: { type: "string" },
      targetType: stringEnumSchema(["draft", "environment", "mcp", "skill", "space", "workflow"]),
    },
    required: [
      "actions",
      "askUser",
      "draftPatch",
      "fieldPath",
      "kind",
      "nodeKey",
      "operation",
      "requiresConfirmation",
      "status",
      "summary",
      "targetType",
    ],
    type: "object",
  };

  return {
    json_schema: {
      name: "agent_builder_planner_output",
      schema: {
        additionalProperties: false,
        properties: {
          assistantText: { type: "string" },
          intentSummary: { type: "string" },
          mode: stringEnumSchema(AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES),
          nodes: {
            items: nodeSchema,
            type: "array",
          },
          version: {
            enum: [1],
            type: "integer",
          },
        },
        required: ["assistantText", "intentSummary", "mode", "nodes", "version"],
        type: "object",
      },
      strict: true,
    },
    type: "json_schema",
  };
}

function createBlockedOutput(input: {
  readonly assistantText: string;
  readonly intentSummary: string;
  readonly nodeKey: string;
  readonly plannerRunId: AgentBuilderPlannerOutput["plannerRunId"];
  readonly summary: string;
}): AgentBuilderPlannerOutput {
  return {
    assistantText: input.assistantText,
    intentSummary: input.intentSummary,
    mode: "blocked",
    nodes: [
      {
        actions: [],
        kind: "blocked",
        nodeKey: input.nodeKey,
        operation: "blocked",
        requiresConfirmation: false,
        status: "blocked",
        summary: input.summary,
        targetType: "workflow",
      },
    ],
    plannerRunId: input.plannerRunId,
    version: 1,
  };
}

function createSystemAgentModelMissingOutput(
  input: AgentBuilderLightweightPlannerInput,
): AgentBuilderPlannerOutput {
  return createBlockedOutput({
    assistantText:
      "Agent Builder needs a System Agent model before it can plan config changes. Choose an available model in Settings, then send the Builder message again.",
    intentSummary: "Block Agent Builder planning because no System Agent model is configured.",
    nodeKey: "blocked_system_agent_model_missing",
    plannerRunId: input.context.plannerRunId,
    summary: "System Agent model is missing.",
  });
}

function createSystemAgentCredentialMissingOutput(
  input: AgentBuilderLightweightPlannerInput,
  provider: string,
): AgentBuilderPlannerOutput {
  return createBlockedOutput({
    assistantText: `Agent Builder needs a ${provider} Provider key before it can plan config changes. Add an available key in Providers, then send the Builder message again.`,
    intentSummary:
      "Block Agent Builder planning because the System Agent provider key is unavailable.",
    nodeKey: "blocked_system_agent_credential_missing",
    plannerRunId: input.context.plannerRunId,
    summary: `Provider credential is unavailable for ${provider}.`,
  });
}

function createSystemAgentProviderBlockedOutput(
  input: AgentBuilderLightweightPlannerInput,
  reason: string,
): AgentBuilderPlannerOutput {
  return createBlockedOutput({
    assistantText: `Agent Builder cannot use the selected System Agent model: ${reason}`,
    intentSummary:
      "Block Agent Builder planning because the selected System Agent provider is invalid.",
    nodeKey: "blocked_system_agent_provider_invalid",
    plannerRunId: input.context.plannerRunId,
    summary: reason,
  });
}

function createSystemAgentPlannerInvalidOutput(
  input: AgentBuilderLightweightPlannerInput,
): AgentBuilderPlannerOutput {
  return createBlockedOutput({
    assistantText:
      "Agent Builder received an invalid structured plan from the model. I did not apply any config changes. Try again with a clearer instruction.",
    intentSummary:
      "Block Agent Builder planning because the model returned invalid planner output.",
    nodeKey: "blocked_system_agent_invalid_planner_output",
    plannerRunId: input.context.plannerRunId,
    summary: "Model output failed AgentBuilderPlannerOutput validation.",
  });
}

function createSystemAgentProviderFailureOutput(
  input: AgentBuilderLightweightPlannerInput,
  message: string,
): AgentBuilderPlannerOutput {
  return createBlockedOutput({
    assistantText: `Agent Builder could not call the model provider: ${message}`,
    intentSummary: "Block Agent Builder planning because the model provider request failed.",
    nodeKey: "blocked_system_agent_provider_failure",
    plannerRunId: input.context.plannerRunId,
    summary: message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOpenAiChatCompletionContent(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload["choices"];

  if (!Array.isArray(choices)) {
    return null;
  }

  const firstChoice = choices[0];

  if (!isRecord(firstChoice)) {
    return null;
  }

  const message = firstChoice["message"];

  if (!isRecord(message)) {
    return null;
  }

  const content = message["content"];
  return typeof content === "string" ? content : null;
}

function parseLlmPlannerOutputJson(
  content: string,
  plannerRunId: AgentBuilderPlannerOutput["plannerRunId"],
): AgentBuilderPlannerOutput | null {
  try {
    const parsed: unknown = JSON.parse(content);

    if (!isRecord(parsed)) {
      return null;
    }

    return parseAgentBuilderPlannerOutput({
      ...parsed,
      plannerRunId,
    });
  } catch {
    return null;
  }
}

function sanitizePlannerFailureMessage(message: string): string {
  return message
    .trim()
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer ***")
    .replaceAll(/\b(sk|rk|pk)-[A-Za-z0-9_*.-]+/gu, "$1-***")
    .slice(0, 220);
}

function buildAgentBuilderLlmPlannerUserPrompt(input: AgentBuilderLightweightPlannerInput): string {
  return JSON.stringify(
    {
      controlPlaneTools: listAgentBuilderControlPlaneToolDescriptors(),
      plannerContext: input.context,
      requiredOutput: "AgentBuilderPlannerOutput JSON only",
    },
    null,
    2,
  );
}

async function callOpenAiShapePlanner(input: {
  readonly apiBase: string;
  readonly apiKey: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly vendor: NonNullable<ReturnType<typeof getRuntimeCatalogVendorForProvider>>;
  readonly bindings: ApiBindings;
}): Promise<{ readonly content: string } | { readonly errorMessage: string }> {
  const response = await fetchVendorProbe(
    toVendorProbeEndpointUrl(input.apiBase, "chat/completions"),
    {
      body: JSON.stringify({
        messages: [
          {
            content: input.systemPrompt,
            role: "system",
          },
          {
            content: input.userPrompt,
            role: "user",
          },
        ],
        model: input.model,
        response_format: createAgentBuilderPlannerResponseFormat(),
        temperature: 0,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...toVendorProbeAuthHeaders(input.vendor, input.apiKey),
      },
      method: "POST",
    },
    AGENT_BUILDER_LLM_PLANNER_TIMEOUT_MS,
    resolveProviderFetchProxy(input.bindings),
  );

  if (!response.ok) {
    return { errorMessage: await readVendorProbeErrorCode(response) };
  }

  const payload: unknown = await response.json();
  const content = readOpenAiChatCompletionContent(payload);

  if (content === null) {
    return { errorMessage: "invalid_chat_completion_response" };
  }

  return { content };
}

export function createAgentBuilderLlmPlanner(input: {
  readonly bindings: ApiBindings;
  readonly viewer: AuthenticatedViewer;
}): AgentBuilderLightweightPlanner {
  let lastModelId: string | undefined;
  let lastProvider: string | undefined;

  return {
    get modelId() {
      return lastModelId ?? "system-agent-model";
    },
    async plan(plannerInput) {
      const selectedModel = plannerInput.context.systemAgent.model;

      if (selectedModel === null) {
        return createSystemAgentModelMissingOutput(plannerInput);
      }

      lastModelId = selectedModel.modelId;
      lastProvider = selectedModel.provider;

      const runtime = getRuntimeCatalogEntry(SYSTEM_AGENT_RUNTIME_ID);

      if (runtime === null) {
        return createSystemAgentProviderBlockedOutput(
          plannerInput,
          "System Agent runtime is missing.",
        );
      }

      const vendor = getRuntimeCatalogVendorForProvider(runtime, selectedModel.provider);

      if (vendor === null) {
        return createSystemAgentProviderBlockedOutput(
          plannerInput,
          `System Agent runtime does not support provider ${selectedModel.provider}.`,
        );
      }

      const credential = await resolveVendorApiKey({
        actorAccountId: input.viewer.id,
        bindings: input.bindings,
        options: { modelId: selectedModel.modelId },
        organizationId: plannerInput.context.agent.organizationId,
        vendorId: selectedModel.provider,
      });

      if (credential === null) {
        return createSystemAgentCredentialMissingOutput(plannerInput, selectedModel.provider);
      }

      const apiBase = credential.apiBase ?? vendor.defaultApiBase ?? null;

      if (apiBase === null) {
        return createSystemAgentProviderBlockedOutput(
          plannerInput,
          `Provider ${selectedModel.provider} requires an API base URL.`,
        );
      }

      const apiBaseErrorCode = validateVendorProbeBaseUrl(apiBase);

      if (apiBaseErrorCode !== null) {
        return createSystemAgentProviderBlockedOutput(
          plannerInput,
          `Provider API base is invalid: ${apiBaseErrorCode}.`,
        );
      }

      reportAgentBuilderProgress(plannerInput.progress, {
        message: "正在调用 System Agent 模型规划 Builder 输出",
        stage: "planner:llm",
      });

      let providerResult: Awaited<ReturnType<typeof callOpenAiShapePlanner>>;

      try {
        providerResult = await callOpenAiShapePlanner({
          apiBase,
          apiKey: credential.apiKey,
          bindings: input.bindings,
          model: selectedModel.modelId,
          systemPrompt: AGENT_BUILDER_LLM_PLANNER_SYSTEM_PROMPT.join("\n"),
          userPrompt: buildAgentBuilderLlmPlannerUserPrompt(plannerInput),
          vendor,
        });
      } catch (error) {
        return createSystemAgentProviderFailureOutput(
          plannerInput,
          sanitizePlannerFailureMessage(
            error instanceof Error ? error.message : "unknown_provider_error",
          ),
        );
      }

      if ("errorMessage" in providerResult) {
        return createSystemAgentProviderFailureOutput(
          plannerInput,
          sanitizePlannerFailureMessage(providerResult.errorMessage),
        );
      }

      const output = parseLlmPlannerOutputJson(
        providerResult.content,
        plannerInput.context.plannerRunId,
      );

      return output ?? createSystemAgentPlannerInvalidOutput(plannerInput);
    },
    get provider() {
      return lastProvider ?? "system-agent";
    },
  };
}
