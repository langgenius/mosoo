import type {
  FileOwnerKind,
  FilePurpose,
  FileScopeKind,
  FileStatus,
  FileUploadStatus,
} from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable, sessionsTable } from "@mosoo/db";
import type { AccountId, FileId, OrganizationId, PlatformId, SessionId, UploadId } from "@mosoo/id";
import { and, eq, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { createFileNotFoundError } from "./file-errors";
import type { FileRecordRow, FileUploadContext, FileUploadRow } from "./file-record-model";
import type { SessionFileAccessRow } from "./session-file-ownership";

export interface FileUploadAccessContext extends FileUploadContext {
  sessionAccess: SessionFileAccessRow | null;
}

interface FileUploadContextRow {
  file_committed: number | null;
  file_created_at: number | null;
  file_created_by_account_id: AccountId | null;
  file_etag: string | null;
  file_expires_at: number | null;
  file_id: FileId | null;
  file_mime_type: string | null;
  file_name: string | null;
  file_object_key: string | null;
  file_owner_id: PlatformId | null;
  file_owner_kind: FileOwnerKind | null;
  file_parent_path: string | null;
  file_path: string | null;
  file_purpose: FilePurpose | null;
  file_scope_id: PlatformId | null;
  file_scope_kind: FileScopeKind | null;
  file_session_kind: "artifact" | "attachment" | null;
  file_size: number | null;
  file_status: FileStatus | null;
  file_updated_at: number | null;
  file_version: number | null;
  upload_content_type: string;
  upload_created_at: number;
  upload_created_by_account_id: AccountId;
  upload_expected_size: number;
  upload_expires_at: number;
  upload_file_id: FileId;
  upload_id: UploadId;
  upload_if_match_etag: string | null;
  upload_multipart_upload_id: string | null;
  upload_overwrite: number;
  upload_part_size: number | null;
  upload_scope_id: PlatformId;
  upload_scope_kind: FileScopeKind;
  upload_status: FileUploadStatus;
  upload_strategy: "multipart" | "single_put";
  upload_updated_at: number;
}

interface FileUploadAccessContextRow extends FileUploadContextRow {
  session_id: SessionId | null;
  session_organization_id: OrganizationId | null;
  session_provider: string | null;
  session_title: string | null;
}

const fileUploadContextColumns = {
  file_committed: sql<number>`${fileRecordsTable.committed}`,
  file_created_at: fileRecordsTable.createdAt,
  file_created_by_account_id: fileRecordsTable.createdByAccountId,
  file_etag: fileRecordsTable.etag,
  file_expires_at: fileRecordsTable.expiresAt,
  file_id: fileRecordsTable.id,
  file_mime_type: fileRecordsTable.mimeType,
  file_name: fileRecordsTable.name,
  file_object_key: fileRecordsTable.objectKey,
  file_owner_id: fileRecordsTable.ownerId,
  file_owner_kind: fileRecordsTable.ownerKind,
  file_parent_path: fileRecordsTable.parentPath,
  file_path: fileRecordsTable.path,
  file_purpose: fileRecordsTable.purpose,
  file_scope_id: fileRecordsTable.scopeId,
  file_scope_kind: fileRecordsTable.scopeKind,
  file_session_kind: fileRecordsTable.sessionKind,
  file_size: fileRecordsTable.size,
  file_status: fileRecordsTable.status,
  file_updated_at: fileRecordsTable.updatedAt,
  file_version: fileRecordsTable.version,
  upload_content_type: fileUploadsTable.contentType,
  upload_created_at: fileUploadsTable.createdAt,
  upload_created_by_account_id: fileUploadsTable.createdByAccountId,
  upload_expected_size: fileUploadsTable.expectedSize,
  upload_expires_at: fileUploadsTable.expiresAt,
  upload_file_id: fileUploadsTable.fileId,
  upload_id: fileUploadsTable.id,
  upload_if_match_etag: fileUploadsTable.ifMatchEtag,
  upload_multipart_upload_id: fileUploadsTable.multipartUploadId,
  upload_overwrite: sql<number>`${fileUploadsTable.overwrite}`,
  upload_part_size: fileUploadsTable.partSize,
  upload_scope_id: fileUploadsTable.scopeId,
  upload_scope_kind: fileUploadsTable.scopeKind,
  upload_status: fileUploadsTable.status,
  upload_strategy: fileUploadsTable.strategy,
  upload_updated_at: fileUploadsTable.updatedAt,
};

function requireJoinedFileValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw createFileNotFoundError(`Upload file record is missing ${fieldName}.`);
  }

  return value;
}

function requireJoinedSessionValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw createFileNotFoundError(`Upload session record is missing ${fieldName}.`);
  }

  return value;
}

function toJoinedFileUploadRecord(row: FileUploadContextRow): FileRecordRow {
  return {
    committed: requireJoinedFileValue(row.file_committed, "committed"),
    created_at: requireJoinedFileValue(row.file_created_at, "created_at"),
    created_by_account_id: requireJoinedFileValue(
      row.file_created_by_account_id,
      "created_by_account_id",
    ),
    etag: row.file_etag,
    expires_at: row.file_expires_at,
    id: requireJoinedFileValue(row.file_id, "id"),
    mime_type: row.file_mime_type,
    name: requireJoinedFileValue(row.file_name, "name"),
    object_key: requireJoinedFileValue(row.file_object_key, "object_key"),
    owner_id: requireJoinedFileValue(row.file_owner_id, "owner_id"),
    owner_kind: requireJoinedFileValue(row.file_owner_kind, "owner_kind"),
    parent_path: requireJoinedFileValue(row.file_parent_path, "parent_path"),
    path: requireJoinedFileValue(row.file_path, "path"),
    purpose: requireJoinedFileValue(row.file_purpose, "purpose"),
    scope_id: requireJoinedFileValue(row.file_scope_id, "scope_id"),
    scope_kind: requireJoinedFileValue(row.file_scope_kind, "scope_kind"),
    session_kind: row.file_session_kind,
    size: requireJoinedFileValue(row.file_size, "size"),
    status: requireJoinedFileValue(row.file_status, "status"),
    updated_at: requireJoinedFileValue(row.file_updated_at, "updated_at"),
    version: requireJoinedFileValue(row.file_version, "version"),
  };
}

function toJoinedFileUpload(row: FileUploadContextRow): FileUploadRow {
  return {
    content_type: row.upload_content_type,
    created_at: row.upload_created_at,
    created_by_account_id: row.upload_created_by_account_id,
    expected_size: row.upload_expected_size,
    expires_at: row.upload_expires_at,
    file_id: row.upload_file_id,
    id: row.upload_id,
    if_match_etag: row.upload_if_match_etag,
    multipart_upload_id: row.upload_multipart_upload_id,
    overwrite: row.upload_overwrite,
    part_size: row.upload_part_size,
    scope_id: row.upload_scope_id,
    scope_kind: row.upload_scope_kind,
    status: row.upload_status,
    strategy: row.upload_strategy,
    updated_at: row.upload_updated_at,
  };
}

function toJoinedSessionFileAccess(row: FileUploadAccessContextRow): SessionFileAccessRow | null {
  if (row.session_id === null) {
    return null;
  }

  return {
    id: row.session_id,
    organization_id: requireJoinedSessionValue(row.session_organization_id, "organization_id"),
    provider: requireJoinedSessionValue(row.session_provider, "provider"),
    title: row.session_title,
  };
}

export async function getFileUploadAccessContextByFileId(
  database: D1Database,
  fileId: FileId,
  viewerId: AccountId,
): Promise<FileUploadAccessContext | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...fileUploadContextColumns,
        session_id: sessionsTable.id,
        session_organization_id: sessionsTable.organizationId,
        session_provider: sessionsTable.provider,
        session_title: sessionsTable.title,
      })
      .from(fileUploadsTable)
      .leftJoin(fileRecordsTable, eq(fileRecordsTable.id, fileUploadsTable.fileId))
      .leftJoin(
        sessionsTable,
        and(
          eq(fileUploadsTable.scopeKind, "session"),
          eq(sessionsTable.id, fileUploadsTable.scopeId),
          or(
            eq(sessionsTable.creatorAccountId, viewerId),
            eq(sessionsTable.attributedUserId, viewerId),
          ),
        ),
      )
      .where(eq(fileUploadsTable.fileId, fileId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  if (row.file_id === null) {
    throw createFileNotFoundError("Upload file record not found.");
  }

  return {
    file: toJoinedFileUploadRecord(row),
    sessionAccess: toJoinedSessionFileAccess(row),
    upload: toJoinedFileUpload(row),
  };
}
