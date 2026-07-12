import type { AccountId, AppId, AppVibeAppId, EnvironmentId, OrganizationId } from "@mosoo/id";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const appsTable = sqliteTable("app", {
  createdAt: integer("created_at").notNull(),
  defaultEnvironmentId: platformIdColumn<EnvironmentId>("default_environment_id"),
  id: platformIdColumn<AppId>("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
  ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const appVibeAppsTable = sqliteTable(
  "app_vibe_app",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<AppVibeAppId>("id").primaryKey(),
    // Null while the queued create is still building the remote app.
    vibeAppId: text("vibe_app_id"),
  },
  (table) => [uniqueIndex("app_vibe_app_app_idx").on(table.appId)],
);

export type AppRow = typeof appsTable.$inferSelect;
export type AppVibeAppRow = typeof appVibeAppsTable.$inferSelect;
