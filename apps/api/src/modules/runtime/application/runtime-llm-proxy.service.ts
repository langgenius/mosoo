import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { DriverInstanceId, ProjectId, VendorCredentialId } from "@mosoo/id";
import { getVendor } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { readSecret } from "../../vault/application/vault-secret-store";
import { getProjectCredentialRow } from "../../vendor-credentials/application/vendor-credential.repository";
import { isDriverInstanceGenerationActive } from "../infrastructure/driver-instance/driver-instance-record.repository";

/**
 * Upstream target for one proxied model call. `apiKey` is the raw vendor
 * secret read from the vault; it exists only inside the Worker for the
 * lifetime of the forwarded request and never reaches the sandbox.
 */
export interface RuntimeLlmProxyTarget {
  apiKey: string;
  modelProtocol: PresetModelProtocol;
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
    modelProtocol: PresetModelProtocol;
    projectId: ProjectId;
  },
): Promise<RuntimeLlmProxyTarget> {
  const credential = await getProjectCredentialRow(
    bindings.DB,
    input.projectId,
    input.credentialId,
  );

  if (credential === null) {
    throw new RuntimeLlmProxyError("Vendor credential is unavailable.", 401);
  }

  const vendor = getVendor(credential.vendorId);

  if (vendor === null) {
    throw new RuntimeLlmProxyError("Vendor is not available.", 502);
  }

  // Existing null protocols retain their legacy runtime-specific meaning.
  // Once explicitly selected, a protocol change revokes older model grants.
  if (
    vendor.vendorId === "openai-compatible" &&
    credential.modelProtocol !== null &&
    credential.modelProtocol !== input.modelProtocol
  ) {
    throw new RuntimeLlmProxyError("Vendor credential model protocol has changed.", 403);
  }

  const upstreamBaseUrl = isTruthy(credential.apiBase)
    ? credential.apiBase
    : (vendor.defaultApiBase ?? null);

  if (!isTruthy(upstreamBaseUrl)) {
    throw new RuntimeLlmProxyError("Vendor upstream endpoint is not configured.", 502);
  }

  return {
    apiKey: await readSecret(bindings.DB, bindings, credential.apiKeySecretId),
    modelProtocol: input.modelProtocol,
    upstreamBaseUrl,
    vendor,
  };
}
