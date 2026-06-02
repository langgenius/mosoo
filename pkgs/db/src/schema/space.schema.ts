import type { SpaceVisibility } from "@mosoo/contracts/space";
import type { AccountId, OrganizationId, SemanticPlatformId, SpaceId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type SpaceDirectoryId = SemanticPlatformId<"SpaceDirectoryId">;

export const spacesTable = sqliteTable(
  "space",
  {
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<SpaceId>("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
    visibility: text("visibility").$type<SpaceVisibility>().notNull(),
  },
  (table) => [
    uniqueIndex("space_organization_name_idx").on(table.organizationId, sql`lower(${table.name})`),
    index("space_organization_owner_idx").on(table.organizationId, table.ownerAccountId),
  ],
);

export const spaceDirectoriesTable = sqliteTable(
  "space_directory",
  {
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    id: platformIdColumn<SpaceDirectoryId>("id").primaryKey(),
    name: text("name").notNull(),
    parentPath: text("parent_path").notNull(),
    path: text("path").notNull(),
    spaceId: platformIdColumn<SpaceId>("space_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("space_directory_path_idx").on(table.spaceId, table.path),
    index("space_directory_listing_idx").on(
      table.spaceId,
      table.parentPath,
      sql`lower(${table.name})`,
    ),
  ],
);

export type SpaceDirectoryRow = typeof spaceDirectoriesTable.$inferSelect;
export type SpaceRow = typeof spacesTable.$inferSelect;
