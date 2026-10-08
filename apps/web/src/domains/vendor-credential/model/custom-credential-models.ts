import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "../api/vendor-credential-client";

// Match the server's existing name/id order: a custom model ID resolves to one
// credential even when several credentials declare it with different protocols.
export function listEffectiveCustomCredentialModels(
  credentials: readonly VendorCredential[],
): { credential: VendorCredential; modelId: string }[] {
  const entries: { credential: VendorCredential; modelId: string }[] = [];
  const seenModelIds = new Set<string>();
  for (const credential of credentials
    .filter((entry) => entry.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId)
    .toSorted(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )) {
    for (const modelId of credential.models ?? []) {
      if (!seenModelIds.has(modelId)) {
        seenModelIds.add(modelId);
        entries.push({ credential, modelId });
      }
    }
  }
  return entries;
}
