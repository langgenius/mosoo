import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { toIsoString } from "../../../time";

interface OrganizationSummaryRow {
  created_at: number;
  id: OrganizationId;
  name: string;
}

export function toOrganizationSummary(row: OrganizationSummaryRow): OrganizationSummary {
  return {
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
  };
}

export function organizationSummaryColumns() {
  return {
    created_at: organizationsTable.createdAt,
    id: organizationsTable.id,
    name: organizationsTable.name,
  };
}

export async function ensureOrganizationOwnership(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<void> {
  const organization =
    (await getAppDatabase(database)
      .select({ creatorAccountId: organizationsTable.creatorAccountId })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  if (organization === null) {
    throw new Error("Organization not found.");
  }

  if (organization.creatorAccountId !== viewerId) {
    throw forbiddenError();
  }
}
