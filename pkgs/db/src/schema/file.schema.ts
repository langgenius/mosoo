import type {
  FileOwnerKind,
  FilePurpose,
  FileScopeKind,
  FileStatus,
  FileUploadStatus,
  FileUploadStrategy,
} from "@mosoo/contracts/file";
import type {
  AccountId,
  DriverInstanceId,
  FileVersionId,
  FileId,
  PlatformId,
  SessionId,
  SessionRunId,
  UploadId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";
import { sessionsTable } from "./session/core.schema";

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
    runtimeEventSeq: integer("runtime_event_seq"),
    scopeId: platformIdColumn<PlatformId>("scope_id"),
    scopeKind: text("scope_kind").$type<FileScopeKind>().notNull(),
    sessionKind: text("session_kind").$type<"artifact" | "attachment">(),
    size: integer("size").notNull(),
    status: text("status").$type<FileStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    check(
      "file_record_runtime_event_seq_check",
      sql`${table.runtimeEventSeq} IS NULL OR ${table.runtimeEventSeq} >= 0`,
    ),
    index("file_record_runtime_event_seq_idx").on(table.scopeId, table.runtimeEventSeq),
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

export type RuntimeArtifactAttemptStatus = "accepted" | "deleting" | "staged" | "staging";

export const runtimeArtifactAttemptsTable = sqliteTable(
  "runtime_artifact_attempt",
  {
    acceptedEventId: text("accepted_event_id"),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    deleteAfter: integer("delete_after"),
    driverConnectionId: text("driver_connection_id").notNull(),
    driverGeneration: integer("driver_generation").notNull(),
    driverInstanceId: platformIdColumn<DriverInstanceId>("driver_instance_id").notNull(),
    eventType: text("event_type").notNull(),
    expiresAt: integer("expires_at"),
    id: text("id").primaryKey(),
    manifestJson: text("manifest_json"),
    manifestSha256: text("manifest_sha256"),
    ownedObjectKeysJson: text("owned_object_keys_json").notNull().default("[]"),
    runId: platformIdColumn<SessionRunId>("run_id").notNull(),
    semanticHash: text("semantic_hash").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    status: text("status").$type<RuntimeArtifactAttemptStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "runtime_artifact_attempt_manifest_check",
      sql`(${table.manifestJson} IS NULL AND ${table.manifestSha256} IS NULL) OR (${table.manifestJson} IS NOT NULL AND json_valid(${table.manifestJson}) = 1 AND json_extract(${table.manifestJson}, '$.version') IS 1 AND json_type(${table.manifestJson}, '$.captureStatus') IS 'text' AND json_extract(${table.manifestJson}, '$.captureStatus') IN ('complete', 'omitted_file_limit', 'omitted_runtime_unavailable', 'omitted_size_limit', 'omitted_source_changed', 'omitted_source_missing') AND json_type(${table.manifestJson}, '$.mode') IS 'text' AND json_extract(${table.manifestJson}, '$.mode') IN ('delta', 'snapshot') AND (json_extract(${table.manifestJson}, '$.captureStatus') = 'complete' OR json_array_length(${table.manifestJson}, '$.files') = 0) AND json_extract(${table.manifestJson}, '$.sourceEventId') IS ${table.sourceEventId} AND json_extract(${table.manifestJson}, '$.semanticHash') IS ${table.semanticHash} AND json_type(${table.manifestJson}, '$.files') IS 'array' AND ${table.manifestSha256} IS NOT NULL AND length(${table.manifestSha256}) = 64 AND ${table.manifestSha256} = lower(${table.manifestSha256}) AND ${table.manifestSha256} NOT GLOB '*[^0-9a-f]*')`,
    ),
    check(
      "runtime_artifact_attempt_owned_keys_check",
      sql`json_valid(${table.ownedObjectKeysJson}) = 1 AND json_type(${table.ownedObjectKeysJson}) IS 'array'`,
    ),
    check(
      "runtime_artifact_attempt_semantic_hash_check",
      sql`length(${table.semanticHash}) = 64 AND ${table.semanticHash} = lower(${table.semanticHash}) AND ${table.semanticHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "runtime_artifact_attempt_status_check",
      sql`(${table.status} = 'staging' AND ${table.manifestJson} IS NULL AND ${table.acceptedEventId} IS NULL AND ${table.expiresAt} IS NOT NULL AND ${table.deleteAfter} IS NULL) OR (${table.status} = 'staged' AND ${table.manifestJson} IS NOT NULL AND ${table.acceptedEventId} IS NULL AND ${table.expiresAt} IS NOT NULL AND ${table.deleteAfter} IS NULL) OR (${table.status} = 'accepted' AND ${table.manifestJson} IS NOT NULL AND ${table.acceptedEventId} IS NOT NULL AND ${table.expiresAt} IS NULL AND ${table.deleteAfter} IS NULL AND json_array_length(${table.ownedObjectKeysJson}) = 0) OR (${table.status} = 'deleting' AND ${table.acceptedEventId} IS NULL AND ${table.deleteAfter} IS NOT NULL)`,
    ),
    check(
      "runtime_artifact_attempt_time_check",
      sql`${table.driverGeneration} >= 0 AND (${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.createdAt}) AND (${table.deleteAfter} IS NULL OR ${table.deleteAfter} >= ${table.createdAt}) AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
    uniqueIndex("runtime_artifact_attempt_accepted_event_idx")
      .on(table.acceptedEventId)
      .where(sql`${table.acceptedEventId} IS NOT NULL`),
    index("runtime_artifact_attempt_cleanup_idx").on(
      table.status,
      table.expiresAt,
      table.updatedAt,
      table.id,
    ),
    index("runtime_artifact_attempt_session_status_idx").on(
      table.sessionId,
      table.status,
      table.id,
    ),
  ],
);

export const sessionArtifactHeadsTable = sqliteTable(
  "session_artifact_head",
  {
    fileId: platformIdColumn<FileId>("file_id"),
    runtimeEventSeq: integer("runtime_event_seq").notNull(),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    sourceEventId: text("source_event_id").notNull(),
    sourcePath: text("source_path").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "session_artifact_head_path_check",
      sql`length(${table.sourcePath}) > 8 AND substr(${table.sourcePath}, 1, 8) = 'outputs/' AND instr(${table.sourcePath}, char(0)) = 0 AND instr(${table.sourcePath}, '\\') = 0 AND ${table.sourcePath} NOT LIKE '%//%' AND ${table.sourcePath} NOT LIKE '%/./%' AND ${table.sourcePath} NOT LIKE '%/.' AND ${table.sourcePath} NOT LIKE '%/../%' AND ${table.sourcePath} NOT LIKE '%/..'`,
    ),
    check(
      "session_artifact_head_seq_check",
      sql`${table.runtimeEventSeq} >= 0 AND ${table.updatedAt} >= 0`,
    ),
    uniqueIndex("session_artifact_head_session_path_idx").on(table.sessionId, table.sourcePath),
    index("session_artifact_head_session_seq_idx").on(
      table.sessionId,
      table.runtimeEventSeq,
      table.sourcePath,
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
export type RuntimeArtifactAttemptRow = typeof runtimeArtifactAttemptsTable.$inferSelect;
export type SessionArtifactHeadRow = typeof sessionArtifactHeadsTable.$inferSelect;
export type FileUploadRow = typeof fileUploadsTable.$inferSelect;
export type FileVersionRow = typeof fileVersionsTable.$inferSelect;
