import type { OrganizationSummary, RenameOrganizationInput } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { requireName } from "../../../shared/require-name";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationOwnership,
  organizationSummaryColumns,
  toOrganizationSummary,
} from "../domain/organization-ownership.policy";

export async function renameOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RenameOrganizationInput,
): Promise<OrganizationSummary> {
  await ensureOrganizationOwnership(database, viewer.id, input.organizationId);

  const organization = await getAppDatabase(database)
    .update(organizationsTable)
    .set({ name: requireName(input.name, "Organization name"), updatedAt: currentTimestampMs() })
    .where(eq(organizationsTable.id, input.organizationId))
    .returning(organizationSummaryColumns())
    .get();

  return toOrganizationSummary(organization);
}
