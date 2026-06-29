import { createResolutionIssue } from "@mosoo/agent-package";
import type {
  AgentResolutionIssue,
  AgentResolutionTargetType,
} from "@mosoo/contracts/agent-manifest";
import { vendorCredentialsTable } from "@mosoo/db";
import type { AccountId, AppId } from "@mosoo/id";
import {
  VENDOR_DEEPSEEK,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
  VENDOR_OPENCODE,
  getRuntimeCatalogEntry,
  getVendor,
} from "@mosoo/runtime-catalog";
import { and, asc, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isApiError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { ensureAppOwnership } from "../../apps/application/app.service";
import { resolveAvailableModels } from "../../vendor-credentials/application/available-models";
import type { ResolvedModelEntry } from "../../vendor-credentials/application/available-models";
import {
  probeVendorCredential,
  resolveProviderFetchProxy,
  resolveVendorApiKey,
} from "../../vendor-credentials/application/vendor-credential.service";

interface RuntimeCapabilitySelection {
  model: string;
  provider: string;
  runtimeId: string;
}

interface RuntimeCapabilityIssueInput {
  actorAccountId: AccountId;
  bindings?: ApiBindings;
  codePrefix: "agent.fork" | "agent.import" | "agent.readiness";
  database: D1Database;
  appId: AppId;
  selection: RuntimeCapabilitySelection;
}

const READINESS_PROVIDER_PROBE_TIMEOUT_MS = 10_000;
const BUILT_IN_OPENAI_SHAPED_PROVIDER_IDS = new Set([
  VENDOR_DEEPSEEK.vendorId,
  VENDOR_OPENAI.vendorId,
  VENDOR_OPENAI_COMPATIBLE.vendorId,
  VENDOR_OPENCODE.vendorId,
]);
const OPENAI_COMPATIBLE_AI_SDK_PACKAGE = "@ai-sdk/openai-compatible";

function allowsOpenAiChatCompletionProbe(providerId: string): boolean {
  if (BUILT_IN_OPENAI_SHAPED_PROVIDER_IDS.has(providerId)) {
    return true;
  }

  return getVendor(providerId)?.openCodeProvider?.npmPackage === OPENAI_COMPATIBLE_AI_SDK_PACKAGE;
}

async function hasAppCredential(
  database: D1Database,
  actorAccountId: AccountId,
  appId: AppId,
  provider: string,
): Promise<boolean> {
  try {
    await ensureAppOwnership(database, actorAccountId, appId);
  } catch (error) {
    if (isApiError(error)) {
      return false;
    }

    throw error;
  }

  const row = await getAppDatabase(database)
    .select({ id: vendorCredentialsTable.id })
    .from(vendorCredentialsTable)
    .where(
      and(eq(vendorCredentialsTable.appId, appId), eq(vendorCredentialsTable.vendorId, provider)),
    )
    .orderBy(asc(vendorCredentialsTable.name), asc(vendorCredentialsTable.id))
    .limit(1)
    .get();

  return Boolean(row);
}

function createCapabilityIssue(input: {
  actionLabel: string;
  code: string;
  message: string;
  required: boolean;
  status: AgentResolutionIssue["status"];
  targetLabel: string;
  targetType: AgentResolutionTargetType;
}): AgentResolutionIssue {
  return createResolutionIssue({
    actionLabel: input.actionLabel,
    code: input.code,
    message: input.message,
    required: input.required,
    status: input.status,
    targetLabel: input.targetLabel,
    targetType: input.targetType,
  });
}

async function collectCredentialIssues(
  input: RuntimeCapabilityIssueInput,
): Promise<AgentResolutionIssue[]> {
  const { provider } = input.selection;
  const required = true;
  const appCredentialAvailable = await hasAppCredential(
    input.database,
    input.actorAccountId,
    input.appId,
    provider,
  );

  if (appCredentialAvailable) {
    return [];
  }

  return [
    createCapabilityIssue({
      actionLabel: "Configure key",
      code: `${input.codePrefix}.provider_credential.missing`,
      message: `Provider ${provider} needs a key in this App.`,
      required,
      status: "needs_reconnect",
      targetLabel: provider,
      targetType: "provider",
    }),
  ];
}

async function collectProviderProbeIssues(
  input: RuntimeCapabilityIssueInput & {
    modelEntry: ResolvedModelEntry | null;
    priorIssues: readonly AgentResolutionIssue[];
  },
): Promise<AgentResolutionIssue[]> {
  const { bindings, modelEntry } = input;

  if (
    !bindings ||
    !modelEntry ||
    !modelEntry.available ||
    input.priorIssues.some((issue) => issue.severity === "error")
  ) {
    return [];
  }

  const credential = await resolveVendorApiKey({
    bindings,
    executionOwnerUserId: input.actorAccountId,
    options: { modelId: input.selection.model },
    appId: input.appId,
    vendorId: input.selection.provider,
  });

  if (!credential) {
    return [];
  }

  const result = await probeVendorCredential({
    allowChatCompletionProbe: allowsOpenAiChatCompletionProbe(input.selection.provider),
    apiBase: credential.apiBase,
    apiKey: credential.apiKey,
    emitEvent: false,
    fetchProxy: resolveProviderFetchProxy(bindings),
    modelId: input.selection.model,
    timeoutMs: READINESS_PROVIDER_PROBE_TIMEOUT_MS,
    vendorId: input.selection.provider,
  });

  if (result.ok) {
    return [];
  }

  // Model availability is already settled upstream by `resolveAvailableModels`
  // (preset catalog + custom credential allowlist). A strict mismatch against
  // the provider's `GET /models` payload — provider only lists dated ids,
  // alias not enumerated, custom OpenAI-compatible base url that requires a
  // model id we already trust — must not block publish. Only auth /
  // connectivity failures should.
  if (result.errorCode === "model_not_found" || result.errorCode === "missing_model_id") {
    return [];
  }

  const errorText = result.errorCode ?? "unknown_error";
  const message = /[.!?。！？]$/.test(errorText)
    ? `Provider error: ${errorText}`
    : `Provider error: ${errorText}.`;

  return [
    createCapabilityIssue({
      actionLabel: "Retry",
      code: `${input.codePrefix}.provider.error`,
      message,
      required: true,
      status: "needs_reconnect",
      targetLabel: modelEntry.vendorLabel,
      targetType: "provider",
    }),
  ];
}

export async function collectRuntimeCapabilityIssues(
  input: RuntimeCapabilityIssueInput,
): Promise<AgentResolutionIssue[]> {
  const issues: AgentResolutionIssue[] = [];
  const { model, provider, runtimeId } = input.selection;
  let modelEntry: ResolvedModelEntry | null = null;

  const runtime = getRuntimeCatalogEntry(runtimeId);

  if (runtime === null) {
    issues.push(
      createCapabilityIssue({
        actionLabel: "Choose runtime",
        code: `${input.codePrefix}.runtime.unsupported`,
        message: `Unsupported runtime: ${runtimeId}.`,
        required: true,
        status: "unsupported",
        targetLabel: runtimeId,
        targetType: "runtime",
      }),
    );
  } else {
    if (isTruthy(runtime.disabledReason)) {
      issues.push(
        createCapabilityIssue({
          actionLabel: "Choose runtime",
          code: `${input.codePrefix}.runtime.disabled`,
          message: runtime.disabledReason,
          required: true,
          status: "unsupported",
          targetLabel: runtime.label,
          targetType: "runtime",
        }),
      );
    }

    modelEntry =
      (
        await resolveAvailableModels(input.database, {
          currentModelId: model,
          currentVendorId: provider,
          appId: input.appId,
          runtimeId,
        })
      ).find((entry) => entry.vendorId === provider && entry.modelId === model) ?? null;

    if (!modelEntry || !modelEntry.available) {
      issues.push(
        createCapabilityIssue({
          actionLabel: "Choose model",
          code: `${input.codePrefix}.model.unavailable`,
          message: modelEntry?.reason
            ? `Model ${model} is not available: ${modelEntry.reason}.`
            : `Model ${model} is not available for runtime ${runtimeId}.`,
          required: true,
          status: "unavailable",
          targetLabel: model,
          targetType: "model",
        }),
      );
    }
  }

  issues.push(...(await collectCredentialIssues(input)));
  issues.push(
    ...(await collectProviderProbeIssues({
      ...input,
      modelEntry,
      priorIssues: issues,
    })),
  );

  return issues;
}
