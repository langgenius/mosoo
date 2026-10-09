import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import type { AccountId } from "@mosoo/id";
import { desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  organizationSummaryColumns,
  toOrganizationSummary,
} from "../../organizations/domain/organization-ownership.policy";

export async function listViewerOrganizations(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationSummary[]> {
  const results = await getAppDatabase(database)
    .select(organizationSummaryColumns())
    .from(organizationsTable)
    .where(eq(organizationsTable.creatorAccountId, accountId))
    .orderBy(desc(organizationsTable.createdAt))
    .all();

  return results.map(toOrganizationSummary);
}
