import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { accountsTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { toOrganizationSummary } from "../../organizations/domain/organization-ownership.policy";

export interface AccountOrganizationState {
  id: AccountId;
  lastActiveOrganizationId: OrganizationId | null;
}

export interface ViewerOrganizationContext {
  activeOrganization: OrganizationSummary | null;
  organizations: OrganizationSummary[];
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

export async function listViewerOrganizations(
  database: D1Database,
  accountId: AccountId,
): Promise<OrganizationSummary[]> {
  const results = await getAppDatabase(database)
    .select({
      avatar_url: organizationsTable.avatarUrl,
      created_at: organizationsTable.createdAt,
      id: organizationsTable.id,
      name: organizationsTable.name,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.creatorAccountId, accountId))
    .orderBy(desc(organizationsTable.createdAt))
    .all();

  return results.map(toOrganizationSummary);
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
  const [account, organizations] = await Promise.all([
    getAccountOrganizationState(database, accountId),
    listViewerOrganizations(database, accountId),
  ]);

  return resolveViewerOrganizationContextFromState(database, account, organizations);
}

export async function resolveViewerOrganizationContextFromState(
  database: D1Database,
  account: AccountOrganizationState,
  organizations: OrganizationSummary[],
): Promise<ViewerOrganizationContext> {
  if (organizations.length === 0) {
    if (isTruthy(account.lastActiveOrganizationId)) {
      await writeLastActiveOrganizationId(database, account.id, null);
    }

    return { activeOrganization: null, organizations };
  }

  const activeOrganization =
    organizations.find((organization) => organization.id === account.lastActiveOrganizationId) ??
    organizations[0];

  if (!activeOrganization) {
    return { activeOrganization: null, organizations };
  }

  if (activeOrganization.id !== account.lastActiveOrganizationId) {
    await writeLastActiveOrganizationId(database, account.id, activeOrganization.id);
  }

  return { activeOrganization, organizations };
}
