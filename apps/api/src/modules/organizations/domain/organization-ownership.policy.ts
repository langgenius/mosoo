import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { toIsoString } from "../../../time";

export interface OrganizationSummaryRow {
  avatar_url: string | null;
  created_at: number;
  id: OrganizationId;
  name: string;
  slug: string;
}

export interface OrganizationOwnership {
  organizationId: OrganizationId;
  ownerAccountId: AccountId;
}

export function toOrganizationSummary(row: OrganizationSummaryRow): OrganizationSummary {
  return {
    avatarUrl: row.avatar_url,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

export function organizationSummaryColumns() {
  return {
    avatar_url: organizationsTable.avatarUrl,
    created_at: organizationsTable.createdAt,
    id: organizationsTable.id,
    name: organizationsTable.name,
    slug: organizationsTable.slug,
  };
}

export async function getOrganizationOwnerAccountId(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<AccountId> {
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

  if (organization.creatorAccountId === null) {
    throw new Error("Organization owner could not be resolved.");
  }

  return organization.creatorAccountId;
}

export async function ensureOrganizationOwnership(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<OrganizationOwnership> {
  const ownerAccountId = await getOrganizationOwnerAccountId(database, organizationId);

  if (ownerAccountId !== viewerId) {
    throw forbiddenError();
  }

  return {
    organizationId,
    ownerAccountId,
  };
}

export async function getOrganizationSummary(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<OrganizationSummary | null> {
  const row =
    (await getAppDatabase(database)
      .select(organizationSummaryColumns())
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  return row === null ? null : toOrganizationSummary(row);
}

export async function getOrganizationSummaryForOwner(
  database: D1Database,
  organizationId: OrganizationId,
  viewerId: AccountId,
): Promise<OrganizationSummary> {
  await ensureOrganizationOwnership(database, viewerId, organizationId);
  const organization = await getOrganizationSummary(database, organizationId);

  if (organization === null) {
    throw new Error("Organization not found.");
  }

  return organization;
}
