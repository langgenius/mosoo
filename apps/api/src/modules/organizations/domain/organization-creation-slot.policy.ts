import type { OrganizationCreationSlotStatus } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import type { AccountId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";

const ORGANIZATION_CREATION_SLOT_ERROR =
  "CE allows one organization you create. You can still join other organizations by invite or request access.";

export function organizationCreationSlotError() {
  return validationError(ORGANIZATION_CREATION_SLOT_ERROR, "ORGANIZATION_CREATION_SLOT_OCCUPIED");
}

export async function getOrganizationCreationSlotStatus(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationCreationSlotStatus> {
  const row =
    (await getAppDatabase(database)
      .select({ organizationId: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.creatorAccountId, accountId))
      .limit(1)
      .get()) ?? null;

  return {
    occupied: row !== null,
    organizationId: row?.organizationId ?? null,
  };
}
