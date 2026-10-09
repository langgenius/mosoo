import type { VendorCredential } from "@mosoo/contracts/vendor-credential";
import type { ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { readSecret } from "../../vault/application/vault-secret-store";
import { toVendorCredentialWithSecret } from "./vendor-credential.mapper";
import { listProjectVendorCredentialRows } from "./vendor-credential.repository";

export async function listVendorCredentials(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<VendorCredential[]> {
  await ensureProjectOwnership(bindings.DB, viewer.id, projectId);
  const rows = await listProjectVendorCredentialRows(bindings.DB, projectId);

  return Promise.all(
    rows.map(async (row) =>
      toVendorCredentialWithSecret(
        row,
        await readSecret(bindings.DB, bindings, row.apiKeySecretId),
      ),
    ),
  );
}
