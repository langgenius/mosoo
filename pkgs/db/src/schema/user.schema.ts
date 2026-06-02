import type { AccountId, OrganizationId } from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const accountsTable = sqliteTable(
  "account",
  {
    createdAt: integer("created_at").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    id: platformIdColumn<AccountId>("id").primaryKey(),
    image: text("image_url"),
    lastActiveOrganizationId: platformIdColumn<OrganizationId>("last_active_organization_id"),
    name: text("name").notNull(),
    systemAgentModel: text("system_agent_model", { mode: "json" }).$type<{
      modelId: string;
      vendor: string;
    } | null>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_email_idx").on(table.email),
    index("account_last_active_organization_idx").on(table.lastActiveOrganizationId),
  ],
);

export type AccountRow = typeof accountsTable.$inferSelect;
export type UserRow = AccountRow;
