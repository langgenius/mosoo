import type {
  TestVendorCredentialInput,
  TestVendorCredentialResult,
} from "@mosoo/contracts/vendor-credential";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";
import { VENDOR_OPENAI_COMPATIBLE, getVendor } from "@mosoo/runtime-catalog";

import { createApiWideEvent, emitApiWideEvent } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationAdmin,
  ensureOrganizationMembership,
} from "../../organizations/domain/organization-access.policy";
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
import { normalizeApiBase } from "./vendor-credential-validation";
import { getPersonalCredentialPolicyError, toCredentialPolicy } from "./vendor-credential.policy";
import { getCredentialPolicyRow } from "./vendor-credential.repository";

export interface VendorCredentialProbeInput {
  allowChatCompletionProbe?: boolean;
  apiBase?: string | null;
  apiKey: string;
  emitEvent?: boolean;
  fetchProxy?: ProviderFetchProxyConfig | null;
  modelId?: string | null;
  timeoutMs?: number;
  vendorId: string;
}

async function probeChatCompletion(input: {
  apiKey: string;
  baseUrl: string;
  fetchProxy: ProviderFetchProxyConfig | null;
  modelId: string;
  timeoutMs: number;
  vendor: RuntimeCatalogVendor;
}): Promise<{ errorCode?: string; ok: boolean }> {
  // OpenAI-shaped vendors can validate a model through chat/completions.
  // Anthropic uses /v1/messages, so readiness disables this branch for non-OpenAI flows.
  const response = await fetchVendorProbe(
    toVendorProbeEndpointUrl(input.baseUrl, "chat/completions"),
    {
      body: JSON.stringify({
        max_tokens: 1,
        messages: [{ content: "ping", role: "user" }],
        model: input.modelId,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...toVendorProbeAuthHeaders(input.vendor, input.apiKey),
      },
      method: "POST",
    },
    input.timeoutMs,
    input.fetchProxy,
  );

  return {
    ...(response.ok ? {} : { errorCode: await readVendorProbeErrorCode(response) }),
    ok: response.ok,
  };
}

function finishCredentialTest(input: {
  baseUrl: string | null;
  emitEvent: boolean;
  errorCode?: string;
  ok: boolean;
  startedAt: number;
  vendorId: string;
}): TestVendorCredentialResult {
  const latencyMs = Date.now() - input.startedAt;

  if (input.emitEvent) {
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
  }

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
  const scope = input.scope ?? "company";

  if (scope === "company") {
    await ensureOrganizationAdmin(database, viewer.id, input.organizationId);
    return;
  }

  await ensureOrganizationMembership(database, viewer.id, input.organizationId);
  const policy = toCredentialPolicy(
    input.organizationId,
    await getCredentialPolicyRow(database, input.organizationId),
  );
  const policyError = getPersonalCredentialPolicyError(policy, input.vendorId);

  if (policyError !== null) {
    throw new Error(policyError);
  }
}

export async function testVendorCredential(
  bindings: Pick<
    ApiBindings,
    "DB" | "MOSOO_PROVIDER_FETCH_PROXY_TOKEN" | "MOSOO_PROVIDER_FETCH_PROXY_URL" | "WEB_ORIGIN"
  >,
  viewer: AuthenticatedViewer,
  input: TestVendorCredentialInput,
): Promise<TestVendorCredentialResult> {
  await ensureCredentialTestAccess(bindings.DB, viewer, input);

  return probeVendorCredential({
    ...input,
    fetchProxy: resolveProviderFetchProxy(bindings),
  });
}

export async function probeVendorCredential(
  input: VendorCredentialProbeInput,
): Promise<TestVendorCredentialResult> {
  const startedAt = Date.now();
  const allowChatCompletionProbe = input.allowChatCompletionProbe ?? true;
  const apiKey = input.apiKey.trim();
  const apiBase = normalizeApiBase(input.apiBase);
  const emitEvent = input.emitEvent ?? true;
  const fetchProxy = input.fetchProxy ?? null;
  const modelId = input.modelId?.trim() ?? null;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const vendor = getVendor(input.vendorId);

  if (vendor === null) {
    throw new Error(`Unknown vendor: ${input.vendorId}.`);
  }
  const modelIdRequired = vendor.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId;

  if (apiKey.length === 0) {
    return finishCredentialTest({
      baseUrl: apiBase,
      emitEvent,
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
      emitEvent,
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
      emitEvent,
      errorCode: baseUrlErrorCode,
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  if (modelIdRequired && modelId === null) {
    return finishCredentialTest({
      baseUrl,
      emitEvent,
      errorCode: "missing_model_id",
      ok: false,
      startedAt,
      vendorId: input.vendorId,
    });
  }

  let ok = false;
  let errorCode: string | undefined;

  try {
    const listResponse = await fetchVendorProbe(
      toVendorProbeEndpointUrl(baseUrl, "models"),
      {
        headers: {
          Accept: "application/json",
          ...toVendorProbeAuthHeaders(vendor, apiKey),
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
          if (allowChatCompletionProbe) {
            const chatProbe = await probeChatCompletion({
              apiKey,
              baseUrl,
              fetchProxy,
              modelId,
              timeoutMs,
              vendor,
            });
            ({ ok } = chatProbe);
            errorCode = chatProbe.ok ? undefined : (chatProbe.errorCode ?? "model_not_found");
          } else {
            errorCode = "model_not_found";
          }
        }
      }
    } else if (listResponse.status !== 404) {
      errorCode = await readVendorProbeErrorCode(listResponse);
    } else if (modelId === null) {
      errorCode = "missing_model_id";
    } else if (allowChatCompletionProbe) {
      const chatProbe = await probeChatCompletion({
        apiKey,
        baseUrl,
        fetchProxy,
        modelId,
        timeoutMs,
        vendor,
      });
      ({ ok } = chatProbe);
      ({ errorCode } = chatProbe);
    } else {
      errorCode = await readVendorProbeErrorCode(listResponse);
    }
  } catch (error) {
    errorCode =
      error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
  }

  return finishCredentialTest({
    baseUrl,
    emitEvent,
    ...(errorCode === undefined ? {} : { errorCode }),
    ok,
    startedAt,
    vendorId: input.vendorId,
  });
}
