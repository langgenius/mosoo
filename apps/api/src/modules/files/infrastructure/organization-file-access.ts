import { Permission, can } from "@mosoo/contracts/permission";
import type { SpaceRole } from "@mosoo/contracts/space";
import { organizationMembersTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { createFileNotFoundError } from "./file-errors";

export async function ensureOrganizationMembership(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ accountId: organizationMembersTable.accountId })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, organizationId),
          eq(organizationMembersTable.accountId, viewerId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw createFileNotFoundError("Organization not found.");
  }
}

export async function ensureOrganizationDraftOwnership(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
  createdBy: AccountId,
  resourceKind: "file" | "upload",
): Promise<void> {
  await ensureOrganizationMembership(database, viewerId, organizationId);

  if (createdBy !== viewerId) {
    throw createFileNotFoundError(
      resourceKind === "file" ? "File not found." : "Upload not found.",
    );
  }
}

export async function ensureOrganizationAvatarAccess(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
  requiredRole: SpaceRole,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ role: organizationMembersTable.role })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, organizationId),
          eq(organizationMembersTable.accountId, viewerId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw createFileNotFoundError("Organization not found.");
  }

  if (requiredRole !== "read" && !can(row.role, Permission.OrgUpdateProfile)) {
    throw createFileNotFoundError("Organization not found.");
  }
}
