import type { VendorCredential } from "@mosoo/contracts/vendor-credential";
import type { AppId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import { listAppVendorCredentialRows } from "./vendor-credential.repository";
import { readVendorCredentialSecret } from "./vendor-credential.secret-resolution";

export async function listVendorCredentials(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<VendorCredential[]> {
  await ensureAppOwnership(bindings.DB, viewer.id, appId);
  const rows = await listAppVendorCredentialRows(bindings.DB, appId);

  return Promise.all(
    rows.map(async (row) => {
      const secret = await readVendorCredentialSecret(bindings, {
        credential: row,
        appId,
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
