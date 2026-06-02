import type { AccountId, OrganizationId, PlatformId, VendorCredentialId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

/**
 * Stores vendor API credentials configured by organization admins.
 *
 * Each row represents one named credential for a vendor within a organization.
 * Secret material is stored in vault_secret and only referenced here.
 */
export const vendorCredentialsTable = sqliteTable(
  "vendor_credential",
  {
    apiBase: text("api_base"),
    apiKeySecretId: platformIdColumn<PlatformId>("api_key_secret_id").notNull(),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<VendorCredentialId>("id").primaryKey(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    isPreferred: integer("is_preferred", { mode: "boolean" }).notNull().default(false),
    models: text("models", { mode: "json" }).$type<string[]>(),
    name: text("name").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id"),
    updatedAt: integer("updated_at").notNull(),
    vendorId: text("vendor_id").notNull(),
  },
  (table) => [
    index("vendor_credential_organization_vendor_idx").on(table.organizationId, table.vendorId),
    index("vendor_credential_organization_vendor_owner_account_idx").on(
      table.organizationId,
      table.vendorId,
      table.ownerAccountId,
    ),
    uniqueIndex("vendor_credential_company_name_idx")
      .on(table.organizationId, table.vendorId, table.name)
      .where(sql`${table.ownerAccountId} IS NULL`),
    uniqueIndex("vendor_credential_personal_name_idx")
      .on(table.organizationId, table.vendorId, table.ownerAccountId, table.name)
      .where(sql`${table.ownerAccountId} IS NOT NULL`),
    uniqueIndex("vendor_credential_personal_preferred_idx")
      .on(table.organizationId, table.vendorId, table.ownerAccountId)
      .where(sql`${table.ownerAccountId} IS NOT NULL AND ${table.isPreferred} = 1`),
    uniqueIndex("vendor_credential_organization_vendor_default_idx")
      .on(table.organizationId, table.vendorId)
      .where(sql`${table.ownerAccountId} IS NULL AND ${table.isDefault} = 1`),
  ],
);

export type VendorCredentialRow = typeof vendorCredentialsTable.$inferSelect;
