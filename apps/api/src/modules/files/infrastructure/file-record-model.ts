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
import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import type { AccountId, FileId, PlatformId, UploadId } from "@mosoo/id";
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
  created_by_account_id: AccountId;
  expected_size: number;
  expires_at: number;
  id: UploadId;
  multipart_upload_id: string | null;
  part_size: number | null;
  scope_id: PlatformId | null;
  scope_kind: FileScopeKind;
  status: FileUploadStatus;
  strategy: "multipart" | "single_put";
}

export const fileUploadRowColumns = {
  content_type: fileUploadsTable.contentType,
  created_by_account_id: fileUploadsTable.createdByAccountId,
  expected_size: fileUploadsTable.expectedSize,
  expires_at: fileUploadsTable.expiresAt,
  id: fileUploadsTable.id,
  multipart_upload_id: fileUploadsTable.multipartUploadId,
  part_size: fileUploadsTable.partSize,
  scope_id: fileUploadsTable.scopeId,
  scope_kind: fileUploadsTable.scopeKind,
  status: fileUploadsTable.status,
  strategy: fileUploadsTable.strategy,
};

const RUNTIME_OUTPUT_PARENT_ROOT = "runtime-output";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

// Inverse of createRuntimeOutputParentPath: recovers the cwd-relative source
// path an artifact was recorded from. Path segments the writer could never
// produce (empty, ".", "..") mark the record malformed, which keeps the value
// safe to use as a workspace-relative write target.
export function parseRuntimeOutputSourcePath(parentPath: string): string | null {
  const segments = parentPath.split("/");
  const contentSha256 = segments.at(-1);

  if (
    segments[0] !== RUNTIME_OUTPUT_PARENT_ROOT ||
    segments.length < 3 ||
    contentSha256 === undefined ||
    !SHA256_PATTERN.test(contentSha256)
  ) {
    return null;
  }

  const pathSegments = segments.slice(1, -1);
  const hasUnsafeSegment = pathSegments.some(
    (segment) => segment.length === 0 || segment === "." || segment === "..",
  );

  return hasUnsafeSegment ? null : pathSegments.join("/");
}

function toRuntimeOutputSourcePath(row: FileRecordRow): string | null {
  if (row.session_kind !== "artifact") {
    return null;
  }

  return parseRuntimeOutputSourcePath(row.parent_path);
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

export interface FileAccessRequest {
  database: D1Database;
  fileId: FileId;
  requiredIntent: FileAccessIntent;
  viewer: AuthenticatedViewer;
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
      id: row.owner_id as FileOwnerId,
      kind: row.owner_kind,
    },
    path: row.scope_kind === "session" ? toSessionResourceMaterializedPath(row.path) : row.path,
    purpose: row.purpose,
    scope: createScope(row.scope_kind, row.scope_id as FileScopeId),
    sessionKind: row.session_kind,
    sourcePath: toRuntimeOutputSourcePath(row),
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

export function toUploadSummary(
  upload: Pick<
    FileUploadRow,
    | "content_type"
    | "expected_size"
    | "expires_at"
    | "part_size"
    | "scope_kind"
    | "status"
    | "strategy"
  >,
  file: Pick<FileRecordRow, "id" | "path">,
): FileUploadSummary {
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
