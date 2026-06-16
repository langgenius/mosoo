import type { AccountId, EnvironmentId, OrganizationId, AppId } from "@mosoo/id";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export type AppRow = typeof appsTable.$inferSelect;
