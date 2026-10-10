import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { DriverInstanceId, VendorCredentialId } from "@mosoo/id";
import { getVendor, resolveRuntimeModelProtocol } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../../shared/truthiness";
import type {
  DriverProfileConfig,
  DriverVendorCredentialProfile,
} from "../../domain/driver-snapshot";
import { RUNTIME_RUN_RETENTION_MS } from "../../domain/runtime-config";
import { getRuntimeDriverLlmProxyPath } from "../../domain/runtime-driver-routes";
import {
  RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH,
  createRuntimeActionToken,
} from "../runtime-boot-token";
import type { RuntimeActionTokenBindings } from "../runtime-boot-token";
import {
  OPENCODE_CONFIG_CONTENT_ENV,
  PI_CONFIG_CONTENT_ENV,
  PI_PROXY_GRANT_ENV,
} from "./runtime-vendor-env-policy";

const OPENAI_IMAGE_MODEL_ID = "gpt-image-2";

export interface VendorProxyEnvironmentInput {
  bindings: RuntimeActionTokenBindings;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
  profile: Pick<DriverProfileConfig, "model" | "modelProtocol" | "runtimeId" | "vendorCredential">;
  requestUrl: string;
}

interface OpenCodeProviderConfigInput {
  credential: DriverVendorCredentialProfile;
  model: string;
  modelProtocol: PresetModelProtocol;
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

  const resolution = resolveRuntimeModelProtocol({
    runtimeId: profile.runtimeId,
    modelId,
    vendorId: vendor.vendorId,
    customModelProtocol: profile.vendorCredential.modelProtocol ?? null,
  });
  if (!resolution.ok) throw new Error(resolution.message);
  if (profile.modelProtocol !== undefined && profile.modelProtocol !== resolution.modelProtocol) {
    throw new Error("The provider model protocol differs from the frozen execution configuration.");
  }
  return { modelId, modelProtocol: profile.modelProtocol ?? resolution.modelProtocol };
}

const OPENCODE_SDK_BY_PROTOCOL: Record<PresetModelProtocol, string> = {
  "anthropic-messages": "@ai-sdk/anthropic",
  "google-gemini": "@ai-sdk/google",
  "openai-chat-completions": "@ai-sdk/openai-compatible",
  "openai-responses": "@ai-sdk/openai",
};

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

  if (credential.vendorId === "openai-compatible" && !isTruthy(credential.apiBase)) {
    throw new Error("Custom providers require an endpoint.");
  }

  const modelBinding = resolveLlmProxyModelBinding(input.profile, vendor);
  const proxyGrant = await createRuntimeActionToken(input.bindings, {
    action: "llm_proxy",
    projectId: credential.projectId,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    expiresAt: Date.now() + RUNTIME_RUN_RETENTION_MS,
    ...(input.profile.runtimeId === "openai-runtime" && vendor.vendorId === "openai"
      ? { imageModelId: OPENAI_IMAGE_MODEL_ID }
      : {}),
    ...modelBinding,
    resourceId: credential.credentialId,
  });
  const proxyUrl = getRuntimeLlmProxyUrl(input.requestUrl, credential.credentialId);
  if (input.profile.runtimeId === "pi") {
    return {
      [PI_PROXY_GRANT_ENV]: proxyGrant,
      [PI_CONFIG_CONTENT_ENV]: JSON.stringify({
        baseUrl: proxyUrl,
        modelProtocol: modelBinding.modelProtocol,
      }),
    };
  }
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
      modelProtocol: modelBinding.modelProtocol,
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

  if (model.startsWith(`${openCodeProviderId}/`)) {
    return model;
  }

  const vendorPrefix = `${vendor.vendorId}/`;

  if (openCodeProviderId !== vendor.vendorId && model.startsWith(vendorPrefix)) {
    return `${openCodeProviderId}/${model.slice(vendorPrefix.length)}`;
  }

  // A slash can belong to the upstream model ID (for example an OpenRouter
  // model), rather than naming the OpenCode provider. Keep it on the provider
  // whose credential and proxy grant were selected for this Run.
  return `${openCodeProviderId}/${model}`;
}

function resolveOpenCodeProviderModelId(vendor: RuntimeCatalogVendor, model: string): string {
  const openCodeProviderId = resolveOpenCodeProviderId(vendor);
  const openCodeModel = resolveOpenCodeModelId(vendor, model);
  const providerPrefix = `${openCodeProviderId}/`;

  return openCodeModel.startsWith(providerPrefix)
    ? openCodeModel.slice(providerPrefix.length)
    : openCodeModel;
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
  // OpenCode removes configured providers that have no models. An unrestricted
  // Mosoo credential still needs the active model rendered for ACP startup.
  const declaredModelIds = new Set(input.credential.models ?? []);
  declaredModelIds.add(resolveOpenCodeProviderModelId(input.vendor, input.model));
  const models = Object.fromEntries(
    [...declaredModelIds].map((modelId) => [modelId, { name: modelId }]),
  );
  const provider = input.vendor.openCodeProvider;

  if (provider === undefined) {
    options["baseURL"] = resolveOpenCodeProxyBaseUrl(input.vendor, input.proxyUrl);

    return {
      models,
      options,
    };
  }

  options["baseURL"] = resolveOpenCodeProxyBaseUrl(input.vendor, input.proxyUrl);

  return {
    models,
    name: provider.name,
    npm:
      input.vendor.vendorId === "openai-compatible"
        ? OPENCODE_SDK_BY_PROTOCOL[input.modelProtocol]
        : provider.npmPackage,
    options,
  };
}
