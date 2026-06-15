import type { PlatformId, AppId, VendorCredentialId } from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

/**
 * Stores App-owned vendor API credentials.
 *
 * Each row represents one named credential for a vendor within an App.
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
    models: text("models", { mode: "json" }).$type<string[]>(),
    name: text("name").notNull(),
    appId: platformIdColumn<AppId>("app_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
    vendorId: text("vendor_id").notNull(),
  },
  (table) => [
    index("vendor_credential_app_vendor_idx").on(table.appId, table.vendorId),
    uniqueIndex("vendor_credential_app_vendor_name_idx").on(
      table.appId,
      table.vendorId,
      table.name,
    ),
  ],
);

export type VendorCredentialRow = typeof vendorCredentialsTable.$inferSelect;
