import type { VendorCredential } from "@mosoo/contracts/vendor-credential";
import type { OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import { toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import { listVisibleVendorCredentialRows } from "./vendor-credential.repository";
import { readVendorCredentialSecret } from "./vendor-credential.secret-resolution";

export async function listVendorCredentials(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<VendorCredential[]> {
  await ensureOrganizationMembership(bindings.DB, viewer.id, organizationId);
  const rows = await listVisibleVendorCredentialRows(bindings.DB, viewer.id, organizationId);

  return Promise.all(
    rows.map(async (row) => {
      const secret = await readVendorCredentialSecret(bindings, {
        actorAccountId: viewer.id,
        credential: row,
        organizationId,
        providerId: row.vendorId,
        purpose: "credential_display_api_key",
      });

      if (secret.status === "denied") {
        throw new Error("Vendor credential secret is unavailable.");
      }

      return toVendorCredentialWithSecret(row, secret.apiKey);
    }),
  );
}
