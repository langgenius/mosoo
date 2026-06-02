import type { SkillSnapshotEntryKind, SkillSourceKind } from "@mosoo/contracts/skill";
import type { AccountId, OrganizationId, SkillId, SkillSnapshotId } from "@mosoo/id";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const skillsTable = sqliteTable(
  "skill",
  {
    author: text("author").notNull(),
    createdAt: integer("created_at").notNull(),
    currentSnapshotId: platformIdColumn<SkillSnapshotId>("current_snapshot_id").notNull(),
    description: text("description").notNull(),
    forkedFromOwnerName: text("forked_from_owner_name"),
    forkedFromSkillId: platformIdColumn<SkillId>("forked_from_skill_id"),
    forkedFromSkillName: text("forked_from_skill_name"),
    id: platformIdColumn<SkillId>("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    sourceKind: text("source_kind").$type<SkillSourceKind>().notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: text("version"),
  },
  (table) => [
    index("skill_organization_updated_at_idx").on(table.organizationId, table.updatedAt),
    index("skill_owner_account_updated_at_idx").on(table.ownerAccountId, table.updatedAt),
  ],
);

export const skillSnapshotsTable = sqliteTable(
  "skill_snapshot",
  {
    author: text("author").notNull(),
    blobKey: text("blob_key").notNull(),
    blobSha256: text("blob_sha256").notNull(),
    blobSize: integer("blob_size").notNull(),
    createdAt: integer("created_at").notNull(),
    description: text("description").notNull(),
    id: platformIdColumn<SkillSnapshotId>("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    skillMarkdownPath: text("skill_markdown_path").notNull(),
    uncompressedSize: integer("uncompressed_size").notNull(),
    version: text("version"),
  },
  (table) => [
    index("skill_snapshot_organization_created_at_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("skill_snapshot_blob_sha256_idx").on(table.organizationId, table.blobSha256),
  ],
);

export const skillSnapshotEntriesTable = sqliteTable(
  "skill_snapshot_entry",
  {
    entryKind: text("entry_kind").$type<SkillSnapshotEntryKind>().notNull(),
    isExecutable: integer("is_executable", { mode: "boolean" }).notNull(),
    mimeType: text("mime_type"),
    path: text("path").notNull(),
    sha256: text("sha256"),
    size: integer("size").notNull(),
    snapshotId: platformIdColumn<SkillSnapshotId>("snapshot_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotId, table.path],
    }),
  ],
);

export const skillPreferencesTable = sqliteTable(
  "skill_preference",
  {
    accountId: platformIdColumn<AccountId>("account_id").notNull(),
    autoEnabled: integer("auto_enabled", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    skillId: platformIdColumn<SkillId>("skill_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.skillId, table.accountId],
    }),
  ],
);
export type SkillPreferenceRow = typeof skillPreferencesTable.$inferSelect;
export type SkillRow = typeof skillsTable.$inferSelect;
export type SkillSnapshotEntryRow = typeof skillSnapshotEntriesTable.$inferSelect;
export type SkillSnapshotRow = typeof skillSnapshotsTable.$inferSelect;
