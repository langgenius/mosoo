import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";
import { getVendor } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { resolveVendorApiKey } from "../../vendor-credentials/application/vendor-credential.secret-resolution";
import { resolveAgentBuilderSystemAgentModelSelection } from "./agent-builder-model-selection.service";
import type { AgentBuilderSystemAgentModelSelection } from "./agent-builder-model-selection.service";
import {
  requestOpenAiWorkflowCodePayload,
  supportsOpenAiWorkflowCodeGeneration,
} from "./builder-workflow-code-openai";
import { parseGeneratedCodePayload } from "./builder-workflow-code-parser";
import {
  createWorkflowCodeCorrectionPrompt,
  createWorkflowCodeGenerationRequestBody,
} from "./builder-workflow-code-prompts";
import type { AgentBuilderWorkflowCodeGenerationRequester } from "./builder-workflow-code-schema";

export type { AgentBuilderWorkflowPlannerCodePlan } from "./builder-workflow-code-plan";
export type {
  AgentBuilderWorkflowCodeGenerationRequester,
  AgentBuilderWorkflowCodeGenerationRequestBody,
} from "./builder-workflow-code-schema";
export {
  validateAgentBuilderAssemblyWorkflowCode,
  validateAgentBuilderAssemblyWorkflowPlan,
} from "./builder-workflow-code-validation";

const WORKFLOW_CODE_GENERATION_ATTEMPTS = 2;

export async function generateAgentBuilderAssemblyWorkflowCodeWithRequester(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly model: string;
  readonly requester: AgentBuilderWorkflowCodeGenerationRequester;
}): Promise<string> {
  let correction: string | undefined;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < WORKFLOW_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const payload = await input.requester(
      createWorkflowCodeGenerationRequestBody({
        ...(correction === undefined ? {} : { correction }),
        context: input.context,
        model: input.model,
      }),
    );

    try {
      return parseGeneratedCodePayload(payload, input.context).code;
    } catch (error) {
      lastError = error;
      correction = createWorkflowCodeCorrectionPrompt(error);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Agent Builder workflow code generation failed.");
}

export async function generateAgentBuilderAssemblyWorkflowCode(input: {
  readonly bindings: ApiBindings;
  readonly context: AgentBuilderPlannerContext;
  readonly plannerSelection?: AgentBuilderSystemAgentModelSelection | null;
  readonly viewer: AuthenticatedViewer;
}): Promise<string> {
  const selection =
    input.plannerSelection === undefined
      ? await resolveAgentBuilderSystemAgentModelSelection(input.bindings.DB, input.viewer.id)
      : input.plannerSelection;

  if (!selection) {
    throw new Error(
      "System Agent model is missing; configure a System Agent model before using Agent Builder Assembly.",
    );
  }

  const vendor = getVendor(selection.provider);

  if (!vendor || !supportsOpenAiWorkflowCodeGeneration(selection.provider)) {
    throw new Error(
      `System Agent provider ${selection.provider} does not support Agent Builder workflow code generation.`,
    );
  }

  const credential = await resolveVendorApiKey({
    actorAccountId: input.viewer.id,
    bindings: input.bindings,
    options: { modelId: selection.model },
    organizationId: input.context.agent.organizationId,
    vendorId: selection.provider,
  });

  if (!credential) {
    throw new Error(
      "System Agent provider credential is missing; configure a Provider Credential before using Agent Builder Assembly.",
    );
  }

  const apiBase = credential.apiBase ?? vendor.defaultApiBase;

  if (!apiBase) {
    throw new Error(`System Agent provider ${selection.provider} has no API base.`);
  }

  let correction: string | undefined;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < WORKFLOW_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const payload = await requestOpenAiWorkflowCodePayload({
      apiBase,
      apiKey: credential.apiKey,
      bindings: input.bindings,
      requestBody: createWorkflowCodeGenerationRequestBody({
        ...(correction === undefined ? {} : { correction }),
        context: input.context,
        model: selection.model,
      }),
    });

    try {
      return parseGeneratedCodePayload(payload, input.context).code;
    } catch (error) {
      lastError = error;
      correction = createWorkflowCodeCorrectionPrompt(error);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Agent Builder workflow code generation failed.");
}
