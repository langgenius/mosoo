import type { ViewerOrganizationMembership } from "@mosoo/contracts/account";
import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { accountsTable, organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs, toIsoString } from "../../../time";
import { toOrganizationSummary } from "../../organizations/domain/organization-access.policy";

export interface AccountOrganizationState {
  id: AccountId;
  lastActiveOrganizationId: OrganizationId | null;
}

export interface ViewerOrganizationContext {
  activeOrganization: OrganizationSummary | null;
  memberships: ViewerOrganizationMembership[];
}

async function getAccountOrganizationState(
  database: D1Database,
  accountId: AccountId,
): Promise<AccountOrganizationState> {
  const account =
    (await getAppDatabase(database)
      .select({
        id: accountsTable.id,
        lastActiveOrganizationId: accountsTable.lastActiveOrganizationId,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!account) {
    throw new Error("Account not found.");
  }

  return account;
}

async function writeLastActiveOrganizationId(
  database: D1Database,
  accountId: AccountId,
  organizationId: OrganizationId | null,
): Promise<void> {
  await getAppDatabase(database)
    .update(accountsTable)
    .set({
      lastActiveOrganizationId: organizationId,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(accountsTable.id, accountId))
    .run();
}

export async function recordLastActiveOrganization(
  database: D1Database,
  accountId: AccountId,
  organizationId: OrganizationId,
): Promise<void> {
  await writeLastActiveOrganizationId(database, accountId, organizationId);
}

export async function listViewerOrganizationMemberships(
  database: D1Database,
  accountId: AccountId,
): Promise<ViewerOrganizationMembership[]> {
  const results = await getAppDatabase(database)
    .select({
      avatar_url: organizationsTable.avatarUrl,
      created_at: organizationsTable.createdAt,
      id: organizationsTable.id,
      joined_at: organizationMembersTable.joinedAt,
      join_policy: organizationsTable.joinPolicy,
      name: organizationsTable.name,
      primary_domain: organizationsTable.primaryDomain,
      role: organizationMembersTable.role,
      slug: organizationsTable.slug,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembersTable.organizationId),
    )
    .where(
      and(
        eq(organizationMembersTable.accountId, accountId),
        isNull(organizationMembersTable.disabledAt),
      ),
    )
    .orderBy(desc(organizationMembersTable.joinedAt))
    .all();

  return results.map((row) => ({
    joinedAt: toIsoString(row.joined_at),
    organization: toOrganizationSummary({ ...row, viewer_role: row.role }),
    role: row.role,
  }));
}

export async function resolveActiveOrganization(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationSummary | null> {
  return (await resolveViewerOrganizationContext(database, accountId)).activeOrganization;
}

async function resolveViewerOrganizationContext(
  database: D1Database,
  accountId: AccountId,
): Promise<ViewerOrganizationContext> {
  const [account, memberships] = await Promise.all([
    getAccountOrganizationState(database, accountId),
    listViewerOrganizationMemberships(database, accountId),
  ]);

  return resolveViewerOrganizationContextFromState(database, account, memberships);
}

export async function resolveViewerOrganizationContextFromState(
  database: D1Database,
  account: AccountOrganizationState,
  memberships: ViewerOrganizationMembership[],
): Promise<ViewerOrganizationContext> {
  if (memberships.length === 0) {
    if (isTruthy(account.lastActiveOrganizationId)) {
      await writeLastActiveOrganizationId(database, account.id, null);
    }

    return { activeOrganization: null, memberships };
  }

  const activeMembership =
    memberships.find(
      (membership) => membership.organization.id === account.lastActiveOrganizationId,
    ) ?? memberships[0];

  if (!activeMembership) {
    return { activeOrganization: null, memberships };
  }

  if (activeMembership.organization.id !== account.lastActiveOrganizationId) {
    await writeLastActiveOrganizationId(database, account.id, activeMembership.organization.id);
  }

  return { activeOrganization: activeMembership.organization, memberships };
}
