import type {
  FileOwnerKind,
  FilePurpose,
  FileScopeKind,
  FileStatus,
  FileUploadStatus,
  FileUploadStrategy,
} from "@mosoo/contracts/file";
import type { AccountId, FileVersionId, FileId, PlatformId, UploadId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type FileVersionReason = "delete" | "directory_delete" | "move_overwrite" | "overwrite";

export const fileRecordsTable = sqliteTable(
  "file_record",
  {
    committed: integer("committed", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    etag: text("etag"),
    expiresAt: integer("expires_at"),
    id: platformIdColumn<FileId>("id").primaryKey(),
    mimeType: text("mime_type"),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull(),
    ownerId: platformIdColumn<PlatformId>("owner_id").notNull(),
    ownerKind: text("owner_kind").$type<FileOwnerKind>().notNull(),
    parentPath: text("parent_path").notNull(),
    path: text("path").notNull(),
    purpose: text("purpose").$type<FilePurpose>().notNull(),
    scopeId: platformIdColumn<PlatformId>("scope_id"),
    scopeKind: text("scope_kind").$type<FileScopeKind>().notNull(),
    sessionKind: text("session_kind").$type<"artifact" | "attachment">(),
    size: integer("size").notNull(),
    status: text("status").$type<FileStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("file_record_object_key_idx").on(table.objectKey),
    uniqueIndex("file_record_unscoped_parent_path_name_status_idx")
      .on(table.scopeKind, table.parentPath, table.name, table.status)
      .where(sql`${table.scopeId} IS NULL`),
    uniqueIndex("file_record_scoped_parent_path_name_status_idx").on(
      table.scopeKind,
      table.scopeId,
      table.parentPath,
      table.name,
      table.status,
    ),
    uniqueIndex("file_record_unscoped_pending_path_idx")
      .on(table.scopeKind, table.path)
      .where(sql`${table.status} = 'pending' AND ${table.scopeId} IS NULL`),
    uniqueIndex("file_record_scoped_pending_path_idx")
      .on(table.scopeKind, table.scopeId, table.path)
      .where(sql`${table.status} = 'pending' AND ${table.scopeId} IS NOT NULL`),
    uniqueIndex("file_record_unscoped_ready_path_idx")
      .on(table.scopeKind, table.path)
      .where(sql`${table.status} = 'ready' AND ${table.scopeId} IS NULL`),
    uniqueIndex("file_record_scoped_ready_path_idx")
      .on(table.scopeKind, table.scopeId, table.path)
      .where(sql`${table.status} = 'ready' AND ${table.scopeId} IS NOT NULL`),
    index("file_record_governance_idx").on(
      table.purpose,
      table.ownerKind,
      table.ownerId,
      table.status,
      table.expiresAt,
    ),
    index("file_record_listing_idx").on(
      table.scopeKind,
      table.scopeId,
      table.parentPath,
      table.status,
      sql`lower(${table.name})`,
    ),
  ],
);

export const fileUploadsTable = sqliteTable(
  "file_upload",
  {
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    expectedSize: integer("expected_size").notNull(),
    expiresAt: integer("expires_at").notNull(),
    fileId: platformIdColumn<FileId>("file_id").notNull(),
    id: platformIdColumn<UploadId>("id").primaryKey(),
    ifMatchEtag: text("if_match_etag"),
    multipartUploadId: text("multipart_upload_id"),
    overwrite: integer("overwrite", { mode: "boolean" }).notNull(),
    partSize: integer("part_size"),
    scopeId: platformIdColumn<PlatformId>("scope_id"),
    scopeKind: text("scope_kind").$type<FileScopeKind>().notNull(),
    status: text("status").$type<FileUploadStatus>().notNull(),
    strategy: text("strategy").$type<FileUploadStrategy>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("file_upload_file_id_idx").on(table.fileId),
    index("file_upload_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

export const fileVersionsTable = sqliteTable(
  "file_version",
  {
    committed: integer("committed", { mode: "boolean" }).notNull(),
    committedAt: integer("committed_at"),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    fileId: platformIdColumn<FileId>("file_id").notNull(),
    id: platformIdColumn<FileVersionId>("id").primaryKey(),
    mimeType: text("mime_type"),
    objectKey: text("object_key").notNull(),
    path: text("path").notNull(),
    reason: text("reason").$type<FileVersionReason>().notNull(),
    scopeId: platformIdColumn<PlatformId>("scope_id"),
    scopeKind: text("scope_kind").$type<FileScopeKind>().notNull(),
    size: integer("size").notNull(),
    sourceEtag: text("source_etag").notNull(),
    sourceObjectKey: text("source_object_key").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("file_version_object_key_idx").on(table.objectKey),
    index("file_version_scope_path_created_idx").on(
      table.scopeKind,
      table.scopeId,
      table.path,
      table.createdAt,
    ),
    index("file_version_file_created_idx").on(table.fileId, table.createdAt),
    index("file_version_pending_idx")
      .on(table.committed, table.createdAt)
      .where(sql`${table.committed} = 0`),
  ],
);

export type FileRecordRow = typeof fileRecordsTable.$inferSelect;
export type FileUploadRow = typeof fileUploadsTable.$inferSelect;
export type FileVersionRow = typeof fileVersionsTable.$inferSelect;
