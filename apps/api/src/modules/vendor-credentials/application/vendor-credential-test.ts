import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type {
  TestVendorCredentialInput,
  TestVendorCredentialResult,
} from "@mosoo/contracts/vendor-credential";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";
import { VENDOR_OPENAI_COMPATIBLE, getPresetModel, getVendor } from "@mosoo/runtime-catalog";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../platform/analytics/product-analytics";
import { createApiWideEvent, emitApiWideEvent } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { resolveRuntimeLlmUpstreamPath } from "../../runtime/domain/runtime-llm-proxy-base-url";
import type { ProviderFetchProxyConfig } from "./provider-fetch-proxy";
import { resolveProviderFetchProxy } from "./provider-fetch-proxy";
import {
  fetchVendorProbe,
  readVendorProbeBaseHost,
  readVendorProbeErrorCode,
  toVendorProbeAuthHeaders,
  toVendorProbeEndpointUrl,
  validateVendorProbeBaseUrl,
  vendorProbeModelListIncludes,
} from "./vendor-credential-probe";
import { normalizeApiBase, normalizeCredentialModelProtocol } from "./vendor-credential-validation";

export interface VendorCredentialProbeInput {
  apiBase?: string | null;
  apiKey: string;
  fetchProxy?: ProviderFetchProxyConfig | null;
  modelId?: string | null;
  modelProtocol?: PresetModelProtocol | null;
  timeoutMs?: number;
  vendorId: string;
  verifyModelProtocol?: boolean;
}

function modelProbeRequest(
  modelId: string,
  protocol: PresetModelProtocol,
): {
  body: object;
  path: string;
} {
  switch (protocol) {
    case "anthropic-messages":
      return {
        body: { max_tokens: 1, messages: [{ content: "ping", role: "user" }], model: modelId },
        path: "/v1/messages",
      };
    case "google-gemini": {
      const modelPath = modelId.startsWith("models/") ? modelId : `models/${modelId}`;
      if (!/^models\/[A-Za-z0-9._-]+$/u.test(modelPath)) {
        throw new Error("Invalid Google model ID.");
      }
      return {
        body: {
          contents: [{ parts: [{ text: "ping" }], role: "user" }],
          generationConfig: { maxOutputTokens: 1 },
        },
        path: `/${modelPath}:generateContent`,
      };
    }
    case "openai-responses":
      return {
        body: { input: "ping", max_output_tokens: 16, model: modelId, store: false },
        path: "/responses",
      };
    case "openai-chat-completions":
      return {
        body: { max_tokens: 1, messages: [{ content: "ping", role: "user" }], model: modelId },
        path: "/chat/completions",
      };
  }
}

function isModelProbeResponse(payload: unknown, protocol: PresetModelProtocol): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  if ("error" in payload && payload.error != null) return false;
  switch (protocol) {
    case "anthropic-messages":
      return (
        "type" in payload &&
        payload.type === "message" &&
        "content" in payload &&
        Array.isArray(payload.content)
      );
    case "google-gemini":
      return (
        "candidates" in payload &&
        Array.isArray(payload.candidates) &&
        payload.candidates.length > 0
      );
    case "openai-responses":
      return (
        "object" in payload &&
        payload.object === "response" &&
        "status" in payload &&
        ["completed", "incomplete"].includes(String(payload.status)) &&
        "output" in payload &&
        Array.isArray(payload.output)
      );
    case "openai-chat-completions":
      return "choices" in payload && Array.isArray(payload.choices) && payload.choices.length > 0;
  }
}

async function probeModelProtocol(input: {
  apiKey: string;
  baseUrl: string;
  fetchProxy: ProviderFetchProxyConfig | null;
  modelId: string;
  modelProtocol: PresetModelProtocol;
  timeoutMs: number;
  vendor: RuntimeCatalogVendor;
  verifyResponse: boolean;
}): Promise<{ errorCode?: string; ok: boolean }> {
  const request = modelProbeRequest(input.modelId, input.modelProtocol);
  const url = new URL(input.baseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname =
    basePath +
    resolveRuntimeLlmUpstreamPath({
      basePath,
      modelProtocol: input.modelProtocol,
      subPath: request.path,
    });
  const response = await fetchVendorProbe(
    url.toString(),
    {
      body: JSON.stringify(request.body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...toVendorProbeAuthHeaders(input.vendor, input.apiKey, input.modelProtocol),
      },
      method: "POST",
    },
    input.timeoutMs,
    input.fetchProxy,
  );

  if (response.ok && input.verifyResponse) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { errorCode: "invalid_model_response", ok: false };
    }
    return isModelProbeResponse(payload, input.modelProtocol)
      ? { ok: true }
      : { errorCode: "invalid_model_response", ok: false };
  }
  return {
    ...(response.ok ? {} : { errorCode: await readVendorProbeErrorCode(response) }),
    ok: response.ok,
  };
}

function finishCredentialTest(input: {
  baseUrl: string | null;
  errorCode?: string;
  ok: boolean;
  startedAt: number;
  vendorId: string;
}): TestVendorCredentialResult {
  const latencyMs = Date.now() - input.startedAt;

  emitApiWideEvent(
    createApiWideEvent("provider.credential_test", {
      fields: {
        provider: {
          baseURLHost: input.baseUrl === null ? "" : readVendorProbeBaseHost(input.baseUrl),
          errorCode: input.errorCode ?? "",
          latencyMs,
          ok: input.ok,
          vendorId: input.vendorId,
        },
      },
    }),
  );

  return {
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    latencyMs,
    ok: input.ok,
  };
}

async function ensureCredentialTestAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: TestVendorCredentialInput,
): Promise<void> {
  await ensureProjectOwnership(database, viewer.id, input.projectId);
}

export async function testVendorCredential(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: TestVendorCredentialInput,
): Promise<TestVendorCredentialResult> {
  await ensureCredentialTestAccess(bindings.DB, viewer, input);

  const result = await probeVendorCredential({
    ...input,
    fetchProxy: resolveProviderFetchProxy(bindings),
    modelProtocol: normalizeCredentialModelProtocol(input.vendorId, input.modelProtocol),
    verifyModelProtocol: Boolean(input.modelId?.trim()),
  });
  if (result.ok) {
    await captureServerProductEvent(bindings, {
      distinctId: viewer.id,
      event: SERVER_PRODUCT_ANALYTICS_EVENTS.integrationConnected,
      properties: {
        project_id: input.projectId,
        integration_type: "model_provider",
        vendor_id: input.vendorId,
      },
    });
  }
  return result;
}

export async function probeVendorCredential(
  input: VendorCredentialProbeInput,
): Promise<TestVendorCredentialResult> {
  const startedAt = Date.now();
  const apiKey = input.apiKey.trim();
  const apiBase = normalizeApiBase(input.apiBase);
  const fetchProxy = input.fetchProxy ?? null;
  const modelId = input.modelId?.trim() || null;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const vendor = getVendor(input.vendorId);

  if (vendor === null) {
    throw new Error(`Unknown vendor: ${input.vendorId}.`);
  }
  const modelIdRequired = vendor.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId;
  const modelProtocol =
    input.modelProtocol ??
    (vendor.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId
      ? "openai-chat-completions"
      : modelId === null
        ? null
        : (getPresetModel({ modelId, vendorId: vendor.vendorId })?.protocol ?? null));

  if (apiKey.length === 0) {
    return finishCredentialTest({
      baseUrl: apiBase,
      errorCode: "missing_api_key",
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  const defaultApiBase = vendor.defaultApiBase ?? null;
  const baseUrl = apiBase ?? defaultApiBase;

  if (baseUrl === null) {
    return finishCredentialTest({
      baseUrl: null,
      errorCode: "missing_api_base",
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  const baseUrlErrorCode = validateVendorProbeBaseUrl(baseUrl);

  if (baseUrlErrorCode !== null) {
    return finishCredentialTest({
      baseUrl,
      errorCode: baseUrlErrorCode,
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  if (modelIdRequired && modelId === null) {
    return finishCredentialTest({
      baseUrl,
      errorCode: "missing_model_id",
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  let ok = false;
  let errorCode: string | undefined;

  try {
    if (input.verifyModelProtocol && modelId !== null) {
      const result =
        modelProtocol === null
          ? { errorCode: "unknown_model_protocol", ok: false }
          : await probeModelProtocol({
              apiKey,
              baseUrl,
              fetchProxy,
              modelId,
              modelProtocol,
              timeoutMs,
              vendor,
              verifyResponse: true,
            });
      return finishCredentialTest({
        baseUrl,
        startedAt,
        vendorId: input.vendorId,
        ...result,
      });
    }

    const listResponse = await fetchVendorProbe(
      toVendorProbeEndpointUrl(baseUrl, "models"),
      {
        headers: {
          Accept: "application/json",
          ...toVendorProbeAuthHeaders(vendor, apiKey, modelProtocol),
        },
        method: "GET",
      },
      timeoutMs,
      fetchProxy,
    );

    if (listResponse.ok) {
      if (modelId === null) {
        ok = true;
      } else {
        const listPayload: unknown = await listResponse.json();
        ok = vendorProbeModelListIncludes(listPayload, modelId);

        if (!ok) {
          if (modelProtocol !== null) {
            const modelProbe = await probeModelProtocol({
              apiKey,
              baseUrl,
              fetchProxy,
              modelId,
              modelProtocol,
              timeoutMs,
              vendor,
              verifyResponse: false,
            });
            ({ ok } = modelProbe);
            errorCode = modelProbe.ok ? undefined : (modelProbe.errorCode ?? "model_not_found");
          } else {
            errorCode = "model_not_found";
          }
        }
      }
    } else if (listResponse.status !== 404) {
      errorCode = await readVendorProbeErrorCode(listResponse);
    } else if (modelId === null) {
      errorCode = "missing_model_id";
    } else if (modelProtocol !== null) {
      const modelProbe = await probeModelProtocol({
        apiKey,
        baseUrl,
        fetchProxy,
        modelId,
        modelProtocol,
        timeoutMs,
        vendor,
        verifyResponse: false,
      });
      ({ ok } = modelProbe);
      ({ errorCode } = modelProbe);
    } else {
      errorCode = await readVendorProbeErrorCode(listResponse);
    }
  } catch (error) {
    errorCode =
      error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
  }

  return finishCredentialTest({
    baseUrl,
    ...(errorCode === undefined ? {} : { errorCode }),
    ok,
    startedAt,
    vendorId: input.vendorId,
  });
}
