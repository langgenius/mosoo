import type { ProjectId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { findCustomCredentialRowForModel } from "./vendor-credential-custom-models";
import { parseCredentialModels } from "./vendor-credential.mapper";
import {
  getProjectVendorCredentialRow,
  listProjectCustomCredentialRows,
} from "./vendor-credential.repository";
import type { ResolvedVendorCredentialRef, VendorCredentialRow } from "./vendor-credential.types";

export interface ResolveVendorApiKeyRequest {
  bindings: ApiBindings;
  options?: { modelId?: string };
  projectId: ProjectId;
  vendorId: string;
}

async function resolveRuntimeVendorCredentialRow({
  bindings,
  options = {},
  projectId,
  vendorId,
}: ResolveVendorApiKeyRequest): Promise<VendorCredentialRow | null> {
  if (vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId && options.modelId !== undefined) {
    return findCustomCredentialRowForModel(
      await listProjectCustomCredentialRows(bindings.DB, projectId),
      options.modelId,
    );
  }

  return getProjectVendorCredentialRow(bindings.DB, projectId, vendorId);
}

/**
 * Resolves the credential a runtime session should use without touching the
 * vault: no secret read happens here. The returned reference is safe to embed
 * in driver profiles; the LLM proxy reads the key back at request time.
 */
export async function resolveVendorCredentialRef(
  request: ResolveVendorApiKeyRequest,
): Promise<ResolvedVendorCredentialRef | null> {
  const row = await resolveRuntimeVendorCredentialRow(request);

  if (!row) {
    return null;
  }

  return {
    apiBase: row.apiBase,
    projectId: row.projectId,
    credentialId: row.id,
    modelProtocol: row.modelProtocol ?? null,
    models: parseCredentialModels(row.modelsJson),
    vendorId: row.vendorId,
  };
}
