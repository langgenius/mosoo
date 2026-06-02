import { organizationsTable, vendorCredentialsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, VendorCredentialId } from "@mosoo/id";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { CredentialPolicyRow, VendorCredentialRow } from "./vendor-credential.types";
export interface PreferredPersonalCredentialRequest {
  actorAccountId: AccountId;
  database: D1Database;
  organizationId: OrganizationId;
  vendorId: string;
}

export async function getCredentialPolicyRow(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<CredentialPolicyRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        byokAllowedProviders: organizationsTable.byokAllowedProviders,
        byokEnabled: sql<number>`${organizationsTable.byokEnabled}`,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Organization not found.");
  }

  return row;
}

function selectVendorCredentialRows(database: D1Database) {
  return getAppDatabase(database)
    .select({
      apiBase: vendorCredentialsTable.apiBase,
      apiKeySecretId: vendorCredentialsTable.apiKeySecretId,
      id: vendorCredentialsTable.id,
      isDefault: sql<number>`${vendorCredentialsTable.isDefault}`,
      isPreferred: sql<number>`${vendorCredentialsTable.isPreferred}`,
      modelsJson: sql<string | null>`${vendorCredentialsTable.models}`,
      name: vendorCredentialsTable.name,
      organizationId: vendorCredentialsTable.organizationId,
      ownerUserId: vendorCredentialsTable.ownerAccountId,
      vendorId: vendorCredentialsTable.vendorId,
    })
    .from(vendorCredentialsTable);
}

export async function listReachableCustomCredentialRows(
  database: D1Database,
  actorAccountId: AccountId,
  organizationId: OrganizationId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(
      and(
        eq(vendorCredentialsTable.organizationId, organizationId),
        eq(vendorCredentialsTable.vendorId, "openai-compatible"),
        or(
          isNull(vendorCredentialsTable.ownerAccountId),
          eq(vendorCredentialsTable.ownerAccountId, actorAccountId),
        ),
      ),
    )
    .orderBy(
      sql`${vendorCredentialsTable.ownerAccountId} IS NOT NULL`,
      asc(vendorCredentialsTable.name),
    )
    .all();
}

export async function listVisibleVendorCredentialRows(
  database: D1Database,
  actorAccountId: AccountId,
  organizationId: OrganizationId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(
      and(
        eq(vendorCredentialsTable.organizationId, organizationId),
        or(
          isNull(vendorCredentialsTable.ownerAccountId),
          eq(vendorCredentialsTable.ownerAccountId, actorAccountId),
        ),
      ),
    )
    .orderBy(
      asc(vendorCredentialsTable.vendorId),
      sql`${vendorCredentialsTable.ownerAccountId} IS NOT NULL`,
      desc(vendorCredentialsTable.isDefault),
      desc(vendorCredentialsTable.isPreferred),
      asc(vendorCredentialsTable.name),
    )
    .all();
}

export async function getCredentialRow(
  database: D1Database,
  id: VendorCredentialId,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(eq(vendorCredentialsTable.id, id))
      .limit(1)
      .get()) ?? null
  );
}

export async function hasDefaultCompanyCredential(
  database: D1Database,
  organizationId: OrganizationId,
  vendorId: string,
): Promise<boolean> {
  const row =
    (await getAppDatabase(database)
      .select({ id: vendorCredentialsTable.id })
      .from(vendorCredentialsTable)
      .where(
        and(
          eq(vendorCredentialsTable.organizationId, organizationId),
          eq(vendorCredentialsTable.vendorId, vendorId),
          isNull(vendorCredentialsTable.ownerAccountId),
          eq(vendorCredentialsTable.isDefault, true),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return Boolean(row);
}

export async function setCompanyCredentialAsDefault(
  database: D1Database,
  credential: VendorCredentialRow,
): Promise<void> {
  const timestampMs = currentTimestampMs();
  const db = getAppDatabase(database);

  await db
    .update(vendorCredentialsTable)
    .set({ isDefault: false, updatedAt: timestampMs })
    .where(
      and(
        eq(vendorCredentialsTable.organizationId, credential.organizationId),
        eq(vendorCredentialsTable.vendorId, credential.vendorId),
        isNull(vendorCredentialsTable.ownerAccountId),
        ne(vendorCredentialsTable.id, credential.id),
      ),
    )
    .run();
  await db
    .update(vendorCredentialsTable)
    .set({ isDefault: true, updatedAt: timestampMs })
    .where(eq(vendorCredentialsTable.id, credential.id))
    .run();
}

export async function setPersonalCredentialAsPreferred(
  database: D1Database,
  credential: VendorCredentialRow,
): Promise<void> {
  if (!isTruthy(credential.ownerUserId)) {
    throw new Error("Company credentials cannot be preferred personal keys.");
  }

  const timestampMs = currentTimestampMs();
  const db = getAppDatabase(database);

  await db
    .update(vendorCredentialsTable)
    .set({ isPreferred: false, updatedAt: timestampMs })
    .where(
      and(
        eq(vendorCredentialsTable.organizationId, credential.organizationId),
        eq(vendorCredentialsTable.vendorId, credential.vendorId),
        eq(vendorCredentialsTable.ownerAccountId, credential.ownerUserId),
        ne(vendorCredentialsTable.id, credential.id),
      ),
    )
    .run();
  await db
    .update(vendorCredentialsTable)
    .set({ isPreferred: true, updatedAt: timestampMs })
    .where(eq(vendorCredentialsTable.id, credential.id))
    .run();
}

export async function getPreferredPersonalCredentialRow({
  actorAccountId,
  database,
  organizationId,
  vendorId,
}: PreferredPersonalCredentialRequest): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(
        and(
          eq(vendorCredentialsTable.organizationId, organizationId),
          eq(vendorCredentialsTable.vendorId, vendorId),
          eq(vendorCredentialsTable.ownerAccountId, actorAccountId),
          eq(vendorCredentialsTable.isPreferred, true),
        ),
      )
      .orderBy(desc(vendorCredentialsTable.updatedAt))
      .limit(1)
      .get()) ?? null
  );
}

export async function getCompanyCredentialRow(
  database: D1Database,
  organizationId: OrganizationId,
  vendorId: string,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(
        and(
          eq(vendorCredentialsTable.organizationId, organizationId),
          eq(vendorCredentialsTable.vendorId, vendorId),
          isNull(vendorCredentialsTable.ownerAccountId),
        ),
      )
      .orderBy(desc(vendorCredentialsTable.isDefault), asc(vendorCredentialsTable.createdAt))
      .limit(1)
      .get()) ?? null
  );
}
