import type { AccountId, EnvironmentId, OrganizationId, ProjectId } from "@mosoo/id";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const projectsTable = sqliteTable("project", {
  createdAt: integer("created_at").notNull(),
  defaultEnvironmentId: platformIdColumn<EnvironmentId>("default_environment_id"),
  id: platformIdColumn<ProjectId>("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
  ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ProjectRow = typeof projectsTable.$inferSelect;
