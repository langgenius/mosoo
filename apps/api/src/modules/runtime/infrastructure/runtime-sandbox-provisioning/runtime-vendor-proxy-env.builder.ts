import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { DriverInstanceId, VendorCredentialId } from "@mosoo/id";
import { getPresetModel, getVendor } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../../shared/truthiness";
import { enforceSafeApiBase } from "../../../vendor-credentials/application/vendor-credential-validation";
import type {
  DriverProfileConfig,
  DriverVendorCredentialProfile,
} from "../../domain/driver-snapshot";
import { RUNTIME_RUN_RETENTION_MS } from "../../domain/runtime-config";
import { getRuntimeDriverLlmProxyPath } from "../../domain/runtime-driver-routes";
import { enforceCanonicalRuntimeLlmProxyBaseUrl } from "../../domain/runtime-llm-proxy-base-url";
import {
  RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH,
  createRuntimeActionToken,
} from "../runtime-boot-token";
import type { RuntimeActionTokenBindings } from "../runtime-boot-token";
import { OPENCODE_CONFIG_CONTENT_ENV } from "./runtime-vendor-env-policy";

export interface VendorProxyEnvironmentInput {
  bindings: RuntimeActionTokenBindings;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
  profile: Pick<DriverProfileConfig, "model" | "runtimeId" | "vendorCredential">;
  requestUrl: string;
}

interface OpenCodeProviderConfigInput {
  credential: DriverVendorCredentialProfile;
  model: string;
  proxyUrl: string;
  vendor: RuntimeCatalogVendor;
}

interface OpenCodeProviderConfig {
  readonly models?: Record<string, { name: string }>;
  readonly name?: string;
  readonly npm?: string;
  readonly options: Record<string, string>;
}

function getRuntimeLlmProxyUrl(requestUrl: string, credentialId: VendorCredentialId): string {
  const url = new URL(requestUrl);
  url.pathname = getRuntimeDriverLlmProxyPath(credentialId);
  url.search = "";
  return url.toString();
}

function resolveVendorModelId(vendorId: string, model: string): string {
  const vendorPrefix = `${vendorId}/`;
  return model.startsWith(vendorPrefix) ? model.slice(vendorPrefix.length) : model;
}

function resolveLlmProxyModelBinding(
  profile: VendorProxyEnvironmentInput["profile"],
  vendor: RuntimeCatalogVendor,
): {
  modelId: string;
  modelProtocol: PresetModelProtocol;
} {
  const modelId = resolveVendorModelId(vendor.vendorId, profile.model);

  if (modelId.length === 0 || modelId.length > RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH) {
    throw new Error(`Model ${profile.model} cannot be bound to an LLM proxy grant.`);
  }

  const preset = getPresetModel({
    modelId,
    vendorId: vendor.vendorId,
  });

  if (profile.runtimeId === "claude-agent-sdk") {
    return { modelId, modelProtocol: "anthropic-messages" };
  }

  if (profile.runtimeId === "openai-runtime") {
    return { modelId, modelProtocol: "openai-responses" };
  }

  if (
    vendor.vendorId === "anthropic" ||
    vendor.openCodeProvider?.npmPackage === "@ai-sdk/anthropic"
  ) {
    return { modelId, modelProtocol: "anthropic-messages" };
  }

  if (vendor.openCodeProvider?.npmPackage === "@ai-sdk/openai-compatible") {
    return { modelId, modelProtocol: "openai-chat-completions" };
  }

  if (preset !== null) {
    return { modelId, modelProtocol: preset.protocol };
  }

  if (vendor.vendorId === "opencode") {
    throw new Error(
      `OpenCode Zen model ${profile.model} has no catalog protocol for LLM proxy admission.`,
    );
  }

  return { modelId, modelProtocol: "openai-chat-completions" };
}

/**
 * Builds the vendor env vars a runtime boots with. The raw provider API key
 * never appears here: runtimes receive a driver-bound `llm_proxy` action grant
 * in the key env var and the Worker LLM proxy URL in the base-URL env var, so
 * every model call authenticates against the control plane, which injects the
 * real upstream credential per request. Anything read out of the sandbox
 * (process env, /proc, boot payload file) only ever exposes the revocable,
 * driver-generation-bound grant.
 */
export async function buildVendorProxyEnvVars(
  input: VendorProxyEnvironmentInput,
): Promise<Record<string, string>> {
  const credential = input.profile.vendorCredential;
  const vendor = getVendor(credential.vendorId);

  if (vendor === null) {
    throw new Error(`Unknown vendor: ${credential.vendorId}.`);
  }

  if (isTruthy(credential.apiBase)) {
    // Fail fast at provisioning time; the proxy enforces this again on every
    // forwarded request in case the credential changes mid-session.
    enforceSafeApiBase(credential.apiBase);
    enforceCanonicalRuntimeLlmProxyBaseUrl(credential.apiBase);
  }

  const modelBinding = resolveLlmProxyModelBinding(input.profile, vendor);
  const proxyGrant = await createRuntimeActionToken(input.bindings, {
    action: "llm_proxy",
    appId: credential.appId,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    expiresAt: Date.now() + RUNTIME_RUN_RETENTION_MS,
    ...modelBinding,
    resourceId: credential.credentialId,
  });
  const proxyUrl = getRuntimeLlmProxyUrl(input.requestUrl, credential.credentialId);
  const envVars: Record<string, string> = {
    [vendor.apiKeyEnvVar]: proxyGrant,
  };

  if (isTruthy(vendor.apiBaseEnvVar)) {
    envVars[vendor.apiBaseEnvVar] = proxyUrl;
  } else if (input.profile.runtimeId !== "acp-fallback") {
    // Without a base-URL env var the runtime would send the grant straight to
    // the vendor, where it is not a valid key. acp-fallback is exempt because
    // OpenCode receives the proxy endpoint through its rendered config below.
    throw new Error(
      `${vendor.label} does not support endpoint redirection for runtime ${input.profile.runtimeId}; the credential cannot be routed through the control-plane LLM proxy.`,
    );
  }

  if (input.profile.runtimeId === "acp-fallback") {
    envVars[OPENCODE_CONFIG_CONTENT_ENV] = buildOpenCodeConfig({
      credential,
      model: input.profile.model,
      proxyUrl,
      vendor,
    });
  }

  return envVars;
}

function buildOpenCodeConfig(input: OpenCodeProviderConfigInput): string {
  const openCodeProviderId = resolveOpenCodeProviderId(input.vendor);
  const model = resolveOpenCodeModelId(input.vendor, input.model);
  const providerConfig = buildOpenCodeProviderConfig(input);

  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    enabled_providers: [openCodeProviderId],
    model,
    provider: {
      [openCodeProviderId]: providerConfig,
    },
    small_model: model,
  });
}

function resolveOpenCodeProviderId(vendor: RuntimeCatalogVendor): string {
  return vendor.openCodeProvider?.providerId ?? vendor.vendorId;
}

function resolveOpenCodeModelId(vendor: RuntimeCatalogVendor, model: string): string {
  const openCodeProviderId = resolveOpenCodeProviderId(vendor);

  if (!model.includes("/")) {
    return `${openCodeProviderId}/${model}`;
  }

  const vendorPrefix = `${vendor.vendorId}/`;

  if (openCodeProviderId !== vendor.vendorId && model.startsWith(vendorPrefix)) {
    return `${openCodeProviderId}/${model.slice(vendorPrefix.length)}`;
  }

  return model;
}

function resolveOpenCodeProxyBaseUrl(vendor: RuntimeCatalogVendor, proxyUrl: string): string {
  // OpenCode's native providers resolve request paths against a base that
  // already contains the SDK path prefix. @ai-sdk/anthropic defaults to
  // https://api.anthropic.com/v1 while the anthropic upstream base mirrored by
  // the proxy is https://api.anthropic.com, so its proxied base keeps the /v1
  // segment on the client side.
  if (vendor.openCodeProvider === undefined && vendor.vendorId === "anthropic") {
    return `${proxyUrl}/v1`;
  }

  return proxyUrl;
}

function buildOpenCodeProviderConfig(input: OpenCodeProviderConfigInput): OpenCodeProviderConfig {
  const options: Record<string, string> = {
    apiKey: `{env:${input.vendor.apiKeyEnvVar}}`,
  };
  const models =
    input.credential.models === null
      ? undefined
      : Object.fromEntries(input.credential.models.map((modelId) => [modelId, { name: modelId }]));
  const provider = input.vendor.openCodeProvider;

  if (provider === undefined) {
    options["baseURL"] = resolveOpenCodeProxyBaseUrl(input.vendor, input.proxyUrl);

    return {
      ...(models === undefined ? {} : { models }),
      options,
    };
  }

  options[provider.apiBaseOption ?? "baseURL"] = resolveOpenCodeProxyBaseUrl(
    input.vendor,
    input.proxyUrl,
  );

  return {
    ...(models === undefined ? {} : { models }),
    name: provider.name,
    npm: provider.npmPackage,
    options,
  };
}
