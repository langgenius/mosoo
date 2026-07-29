import type { DriverInstanceId, AppId, VendorCredentialId } from "@mosoo/id";
import { getVendor } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { enforceSafeApiBase } from "../../vendor-credentials/application/vendor-credential-validation";
import { getAppCredentialRow } from "../../vendor-credentials/application/vendor-credential.repository";
import { readVendorCredentialSecret } from "../../vendor-credentials/application/vendor-credential.secret-resolution";
import { enforceCanonicalRuntimeLlmProxyBaseUrl } from "../domain/runtime-llm-proxy-base-url";
import { isDriverInstanceGenerationActive } from "../infrastructure/driver-instance/driver-instance-record.repository";

/**
 * Upstream target for one proxied model call. `apiKey` is the raw vendor
 * secret read from the vault; it exists only inside the Worker for the
 * lifetime of the forwarded request and never reaches the sandbox.
 */
export interface RuntimeLlmProxyTarget {
  apiKey: string;
  upstreamBaseUrl: string;
  vendor: RuntimeCatalogVendor;
}

export class RuntimeLlmProxyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RuntimeLlmProxyError";
    this.status = status;
  }
}

export async function requireActiveRuntimeLlmProxyDriver(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
  },
): Promise<void> {
  const driverIsActive = await isDriverInstanceGenerationActive(bindings.DB, {
    driverInstanceId: input.driverInstanceId,
    generation: input.driverGeneration,
  });

  if (!driverIsActive) {
    throw new RuntimeLlmProxyError("LLM proxy grant driver instance is not active.", 403);
  }
}

export async function resolveRuntimeLlmProxyTarget(
  bindings: ApiBindings,
  input: {
    credentialId: VendorCredentialId;
    appId: AppId;
  },
): Promise<RuntimeLlmProxyTarget> {
  const credential = await getAppCredentialRow(bindings.DB, input.appId, input.credentialId);

  if (credential === null) {
    throw new RuntimeLlmProxyError("Vendor credential is unavailable.", 401);
  }

  const vendor = getVendor(credential.vendorId);

  if (vendor === null) {
    throw new RuntimeLlmProxyError("Vendor is not available.", 502);
  }

  const secret = await readVendorCredentialSecret(bindings, {
    credential,
    appId: input.appId,
    providerId: credential.vendorId,
    purpose: "llm_proxy_api_key",
  });

  if (secret.status === "denied") {
    throw new RuntimeLlmProxyError("Vendor credential is unavailable.", 401);
  }

  const upstreamBaseUrl = isTruthy(credential.apiBase)
    ? credential.apiBase
    : (vendor.defaultApiBase ?? null);

  if (!isTruthy(upstreamBaseUrl)) {
    throw new RuntimeLlmProxyError("Vendor upstream endpoint is not configured.", 502);
  }

  try {
    enforceSafeApiBase(upstreamBaseUrl);
    enforceCanonicalRuntimeLlmProxyBaseUrl(upstreamBaseUrl);
  } catch (error) {
    throw new RuntimeLlmProxyError(
      error instanceof Error ? error.message : "Vendor upstream endpoint is not allowed.",
      502,
    );
  }

  return {
    apiKey: secret.apiKey,
    upstreamBaseUrl,
    vendor,
  };
}
