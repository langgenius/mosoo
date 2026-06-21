import type {
  FileEntry,
  FileRecord,
  FileOwnerId,
  FileOwnerKind,
  FilePurpose,
  FileScopeId,
  FileScopeKind,
  FileStatus,
  FileUploadStatus,
  FileUploadSummary,
} from "@mosoo/contracts/file";
import { toSessionResourceMaterializedPath } from "@mosoo/contracts/file";
import type { SessionFile } from "@mosoo/contracts/session";
import { fileRecordsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, PlatformId, AppId, SessionId, UploadId } from "@mosoo/id";
import { sql } from "drizzle-orm";

import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createScope } from "./file-paths";

export type FileAccessIntent = "view" | "write";

export interface FileRecordRow {
  committed: number;
  created_at: number;
  created_by_account_id: AccountId;
  etag: string | null;
  expires_at: number | null;
  id: FileId;
  mime_type: string | null;
  name: string;
  object_key: string;
  owner_id: PlatformId;
  owner_kind: FileOwnerKind;
  parent_path: string;
  path: string;
  purpose: FilePurpose;
  scope_id: PlatformId | null;
  scope_kind: FileScopeKind;
  session_kind: "artifact" | "attachment" | null;
  size: number;
  status: FileStatus;
  updated_at: number;
  version: number;
}

export const fileRecordRowColumns = {
  committed: sql<number>`${fileRecordsTable.committed}`,
  created_at: fileRecordsTable.createdAt,
  created_by_account_id: fileRecordsTable.createdByAccountId,
  etag: fileRecordsTable.etag,
  expires_at: fileRecordsTable.expiresAt,
  id: fileRecordsTable.id,
  mime_type: fileRecordsTable.mimeType,
  name: fileRecordsTable.name,
  object_key: fileRecordsTable.objectKey,
  owner_id: fileRecordsTable.ownerId,
  owner_kind: fileRecordsTable.ownerKind,
  parent_path: fileRecordsTable.parentPath,
  path: fileRecordsTable.path,
  purpose: fileRecordsTable.purpose,
  scope_id: fileRecordsTable.scopeId,
  scope_kind: fileRecordsTable.scopeKind,
  session_kind: fileRecordsTable.sessionKind,
  size: fileRecordsTable.size,
  status: fileRecordsTable.status,
  updated_at: fileRecordsTable.updatedAt,
  version: fileRecordsTable.version,
};

export interface FileUploadRow {
  content_type: string;
  created_at: number;
  created_by_account_id: AccountId;
  expected_size: number;
  expires_at: number;
  file_id: FileId;
  id: UploadId;
  if_match_etag: string | null;
  multipart_upload_id: string | null;
  overwrite: number;
  part_size: number | null;
  scope_id: PlatformId | null;
  scope_kind: FileScopeKind;
  status: FileUploadStatus;
  strategy: "multipart" | "single_put";
  updated_at: number;
}

export interface FileCleanupRow extends FileRecordRow {
  multipartUploadId: string | null;
  strategy: "multipart" | "single_put" | null;
  uploadId: UploadId | null;
}

export interface FileUploadContext {
  file: FileRecordRow;
  upload: FileUploadRow;
}

export interface FilePathLookupRequest {
  database: D1Database;
  path: string;
  scopeId: PlatformId | null;
  scopeKind: FileScopeKind;
}

export interface UploadAccessRequest {
  database: D1Database;
  fileId: FileId;
  requiredIntent: FileAccessIntent;
  viewer: AuthenticatedViewer;
}

export interface FileAccessRequest {
  database: D1Database;
  fileId: FileId;
  requiredIntent: FileAccessIntent;
  viewer: AuthenticatedViewer;
}

function toFileScopeId(scopeKind: FileScopeKind, scopeId: PlatformId | null): FileScopeId {
  if (scopeId === null) {
    throw new Error(`${scopeKind} file scope ID is required.`);
  }

  if (scopeKind === "agent_package" || scopeKind === "app_draft" || scopeKind === "library") {
    return parsePlatformId<AppId>(scopeId, "file app ID");
  }

  if (scopeKind === "session") {
    return parsePlatformId<SessionId>(scopeId, "file session ID");
  }

  const unsupported: never = scopeKind;
  void unsupported;
  throw new Error("Unsupported file scope kind.");
}

function toFileOwnerId(ownerKind: FileOwnerKind, ownerId: PlatformId): FileOwnerId {
  if (ownerKind === "account") {
    return parsePlatformId<AccountId>(ownerId, "file owner account ID");
  }

  if (ownerKind === "app") {
    return parsePlatformId<AppId>(ownerId, "file owner app ID");
  }

  if (ownerKind === "session") {
    return parsePlatformId<SessionId>(ownerId, "file owner session ID");
  }

  const unsupported: never = ownerKind;
  void unsupported;
  throw new Error("Unsupported file owner kind.");
}

export function toFileRecord(row: FileRecordRow): FileRecord {
  return {
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by_account_id,
    etag: row.etag,
    expiresAt: row.expires_at === null ? null : toIsoString(row.expires_at),
    id: row.id,
    mimeType: row.mime_type,
    name: row.name,
    owner: {
      id: toFileOwnerId(row.owner_kind, row.owner_id),
      kind: row.owner_kind,
    },
    path: row.scope_kind === "session" ? toSessionResourceMaterializedPath(row.path) : row.path,
    purpose: row.purpose,
    scope: createScope(row.scope_kind, toFileScopeId(row.scope_kind, row.scope_id)),
    sessionKind: row.session_kind,
    size: row.size,
    status: row.status,
    updatedAt: toIsoString(row.updated_at),
    version: row.version,
  };
}

export function toFileEntry(file: FileRecord): FileEntry {
  return {
    createdAt: file.createdAt,
    createdBy: file.createdBy,
    etag: file.etag,
    expiresAt: file.expiresAt,
    id: file.id,
    mimeType: file.mimeType,
    name: file.name,
    path: file.path,
    sessionKind: file.sessionKind,
    size: file.size,
    status: file.status,
    updatedAt: file.updatedAt,
    version: file.version,
  };
}

export function toFileEntryFromRow(row: FileRecordRow): FileEntry {
  return toFileEntry(toFileRecord(row));
}

export function toUploadSummary(upload: FileUploadRow, file: FileRecordRow): FileUploadSummary {
  return {
    contentType: upload.content_type,
    expectedSize: upload.expected_size,
    expiresAt: toIsoString(upload.expires_at),
    fileId: file.id,
    partSize: upload.part_size,
    path:
      upload.scope_kind === "session" ? toSessionResourceMaterializedPath(file.path) : file.path,
    status: upload.status,
    strategy: upload.strategy,
  };
}

export function toSessionFile(row: FileRecordRow): SessionFile {
  return {
    committed: row.committed === 1,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    kind: row.session_kind ?? "attachment",
    mimeType: row.mime_type,
    name: row.name,
    size: row.size,
  };
}
