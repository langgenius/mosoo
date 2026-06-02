import type {
  OrganizationCreationSlotStatus,
  OrganizationKind,
} from "@mosoo/contracts/organization";
import { organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, validationError } from "../../../platform/errors";

interface OrganizationKindColumns {
  joinPolicy: AnySQLiteColumn;
  primaryDomain: AnySQLiteColumn;
}

const ORGANIZATION_CREATION_SLOT_ERROR =
  "CE allows one organization you create. You can still join other organizations by invite or request access.";
const PERSONAL_ORGANIZATION_SLOT_ERROR = "You already have a Personal Org.";

export function organizationKindValue(table: OrganizationKindColumns = organizationsTable) {
  return sql<OrganizationKind>`
    case
      when ${table.primaryDomain} is null and ${table.joinPolicy} = 'invite_only'
      then 'personal'
      else 'team'
    end
  `;
}

export function normalizeOrganizationKind(
  kind: OrganizationKind | null | undefined,
): OrganizationKind {
  if (kind === undefined || kind === null) {
    return "team";
  }

  enforceValidOrganizationKind(kind);
  return kind;
}

export function enforceValidOrganizationKind(kind: OrganizationKind): void {
  if (kind !== "personal" && kind !== "team") {
    throw validationError("Invalid organization kind.");
  }
}

export function organizationCreationSlotError() {
  return validationError(ORGANIZATION_CREATION_SLOT_ERROR, "ORGANIZATION_CREATION_SLOT_OCCUPIED");
}

export function personalOrganizationSlotError() {
  return validationError(PERSONAL_ORGANIZATION_SLOT_ERROR, "PERSONAL_ORGANIZATION_SLOT_OCCUPIED");
}

export async function getOrganizationCreationSlotStatus(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationCreationSlotStatus> {
  const row =
    (await getAppDatabase(database)
      .select({ organizationId: organizationsTable.id })
      .from(organizationsTable)
      .where(
        and(
          eq(organizationsTable.creatorAccountId, accountId),
          sql`${organizationKindValue()} = 'team'`,
        ),
      )
      .limit(1)
      .get()) ?? null;

  return {
    occupied: row !== null,
    organizationId: row?.organizationId ?? null,
  };
}

export async function getPersonalOrganizationSlotStatus(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationCreationSlotStatus> {
  const row =
    (await getAppDatabase(database)
      .select({ organizationId: organizationsTable.id })
      .from(organizationsTable)
      .innerJoin(
        organizationMembersTable,
        eq(organizationMembersTable.organizationId, organizationsTable.id),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, accountId),
          eq(organizationMembersTable.role, "owner"),
          sql`${organizationKindValue()} = 'personal'`,
        ),
      )
      .limit(1)
      .get()) ?? null;

  return {
    occupied: row !== null,
    organizationId: row?.organizationId ?? null,
  };
}

export async function enforceOrganizationAcceptsCollaborators(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ kind: organizationKindValue() })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Organization not found.");
  }

  enforceOrganizationKindAcceptsCollaborators(row.kind);
}

export function enforceOrganizationKindAcceptsCollaborators(kind: OrganizationKind): void {
  if (kind === "personal") {
    throw forbiddenError("Convert this Personal Org to collaborate with others.");
  }
}
