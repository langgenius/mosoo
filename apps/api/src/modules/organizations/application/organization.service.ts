import type { OrganizationSummary, RenameOrganizationInput } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeOrganizationName } from "../domain/organization-name";
import {
  ensureOrganizationOwnership,
  getOrganizationSummary,
} from "../domain/organization-ownership.policy";

export async function renameOrganization(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RenameOrganizationInput,
): Promise<OrganizationSummary> {
  await ensureOrganizationOwnership(database, viewer.id, input.organizationId);

  const name = normalizeOrganizationName(input.name);

  await getAppDatabase(database)
    .update(organizationsTable)
    .set({ name, updatedAt: currentTimestampMs() })
    .where(eq(organizationsTable.id, input.organizationId))
    .run();

  const organization = await getOrganizationSummary(database, input.organizationId);

  if (organization === null) {
    throw new Error("Organization not found.");
  }

  return organization;
}
