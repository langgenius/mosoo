import { VENDOR_OPENAI, VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  fetchViaProviderProxy,
  resolveProviderFetchProxy,
} from "../../vendor-credentials/application/provider-fetch-proxy";
import type { AgentBuilderWorkflowCodeGenerationRequestBody } from "./builder-workflow-code-schema";

const WORKFLOW_CODE_LLM_REQUEST_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function endpointUrl(apiBase: string, suffix: "responses"): string {
  const trimmed = apiBase.replace(/\/+$/u, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/${suffix}` : `${trimmed}/v1/${suffix}`;
}

async function fetchProvider(
  url: string,
  init: RequestInit,
  bindings: ApiBindings,
): Promise<Response> {
  const fetchProxy = resolveProviderFetchProxy(bindings);

  if (fetchProxy === null) {
    return fetch(url, init);
  }

  return fetchViaProviderProxy(url, init, WORKFLOW_CODE_LLM_REQUEST_TIMEOUT_MS, fetchProxy);
}

export function supportsOpenAiWorkflowCodeGeneration(provider: string): boolean {
  return provider === VENDOR_OPENAI.vendorId || provider === VENDOR_OPENAI_COMPATIBLE.vendorId;
}

export async function requestOpenAiWorkflowCodePayload(input: {
  apiBase: string;
  apiKey: string;
  bindings: ApiBindings;
  requestBody: AgentBuilderWorkflowCodeGenerationRequestBody;
}): Promise<unknown> {
  const response = await fetchProvider(
    endpointUrl(input.apiBase, "responses"),
    {
      body: JSON.stringify(input.requestBody),
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
    input.bindings,
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && "error" in payload
        ? JSON.stringify(payload["error"])
        : response.statusText;
    throw new Error(`Agent Builder workflow code LLM request failed: ${errorMessage}`);
  }

  return payload;
}
