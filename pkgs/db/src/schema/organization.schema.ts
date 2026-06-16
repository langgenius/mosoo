import type { AccountId, OrganizationId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const organizationsTable = sqliteTable(
  "organization",
  {
    avatarUrl: text("avatar_url"),
    createdAt: integer("created_at").notNull(),
    creatorAccountId: platformIdColumn<AccountId>("creator_account_id"),
    id: platformIdColumn<OrganizationId>("id").primaryKey(),
    name: text("name").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_creator_account_idx")
      .on(table.creatorAccountId)
      .where(sql`${table.creatorAccountId} IS NOT NULL`),
  ],
);

export type OrganizationRow = typeof organizationsTable.$inferSelect;
