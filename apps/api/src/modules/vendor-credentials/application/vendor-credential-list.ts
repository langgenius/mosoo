import type { VendorCredential } from "@mosoo/contracts/vendor-credential";
import type { ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import { listProjectVendorCredentialRows } from "./vendor-credential.repository";
import { readVendorCredentialSecret } from "./vendor-credential.secret-resolution";

export async function listVendorCredentials(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<VendorCredential[]> {
  await ensureProjectOwnership(bindings.DB, viewer.id, projectId);
  const rows = await listProjectVendorCredentialRows(bindings.DB, projectId);

  return Promise.all(
    rows.map(async (row) => {
      const secret = await readVendorCredentialSecret(bindings, {
        credential: row,
        projectId,
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
