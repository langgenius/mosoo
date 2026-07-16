import { parsePlatformId } from "@mosoo/id";

import type { AccountId, FileId, AppId, SessionId } from "../id/id.contract";

export const FILE_SCOPE_KINDS = [
  "account",
  "agent_package",
  "app_draft",
  "library",
  "session",
] as const;
export type FileScopeKind = (typeof FILE_SCOPE_KINDS)[number];

export const FILE_STATUSES = ["deleting", "failed", "pending", "ready"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const FILE_UPLOAD_STATUSES = [
  "aborted",
  "completed",
  "completing",
  "expired",
  "failed",
  "pending",
  "uploading",
] as const;
export type FileUploadStatus = (typeof FILE_UPLOAD_STATUSES)[number];

export const FILE_UPLOAD_STRATEGIES = ["multipart", "single_put"] as const;
export type FileUploadStrategy = (typeof FILE_UPLOAD_STRATEGIES)[number];
export const FILE_PURPOSES = [
  "account_avatar",
  "agent_asset",
  "agent_package",
  "app_draft",
  "library_file",
  "session_attachment",
  "session_artifact",
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];
export const FILE_OWNER_KINDS = ["account", "app", "session"] as const;
export type FileOwnerKind = (typeof FILE_OWNER_KINDS)[number];
export const FILE_SESSION_KINDS = ["artifact", "attachment"] as const;
export type FileSessionKind = (typeof FILE_SESSION_KINDS)[number];
export const LIBRARY_FILE_EXTENSION_REQUIRED_MESSAGE = "File name must include an extension.";
export const SINGLE_PUT_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value.charCodeAt(start) === 0x2f) {
    start += 1;
  }

  while (end > start && value.charCodeAt(end - 1) === 0x2f) {
    end -= 1;
  }

  return value.slice(start, end);
}

function assertRelativePathOriginal(path: string): void {
  const normalized = path.trim();

  if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    throw new Error("Path cannot be absolute.");
  }

  if (normalized.endsWith("/") || normalized.endsWith("\\")) {
    throw new Error("Path cannot end with a separator.");
  }
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function assertCanonicalPathSegment(segment: string): void {
  if (isDotSegment(segment)) {
    throw new Error("Path segment cannot be '.' or '..'.");
  }

  const decoded = decodePathSegment(segment);

  if (decoded === null || decoded === segment) {
    return;
  }

  if (isDotSegment(decoded) || decoded.includes("/") || decoded.includes("\\")) {
    throw new Error("Path segment contains non-canonical encoding.");
  }
}

export function normalizeFileName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("File name is required.");
  }

  if (normalized.includes("/")) {
    throw new Error("File name cannot include '/'.");
  }

  if (normalized.includes("\\")) {
    throw new Error("File name cannot include '\\'.");
  }

  if (hasControlCharacter(normalized)) {
    throw new Error("File name cannot include control characters.");
  }

  assertCanonicalPathSegment(normalized);

  return normalized;
}

export function normalizeOptionalPath(path?: string | null): string {
  if (!path) {
    return "";
  }

  return trimSlashes(path);
}

export function joinPath(parentPath: string, name: string): string {
  const normalizedName = normalizeFileName(name);
  const normalizedParentPath = normalizeLibraryDirectoryPath(parentPath);

  return normalizedParentPath ? `${normalizedParentPath}/${normalizedName}` : normalizedName;
}

export function getParentPath(path: string): string {
  const normalizedPath = normalizeOptionalPath(path);

  if (!normalizedPath) {
    return "";
  }

  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  return lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
}

export function getLibraryFileNameExtensionError(name: string): string | null {
  const normalizedName = name.trim();

  if (!normalizedName) {
    return LIBRARY_FILE_EXTENSION_REQUIRED_MESSAGE;
  }

  const lastDotIndex = normalizedName.lastIndexOf(".");

  if (lastDotIndex === -1 || lastDotIndex === normalizedName.length - 1) {
    return LIBRARY_FILE_EXTENSION_REQUIRED_MESSAGE;
  }

  return null;
}

function normalizeLibraryPath(
  path: string | null | undefined,
  input: { allowEmpty: boolean },
): string {
  if (path != null) {
    assertRelativePathOriginal(path);
  }

  const normalized = normalizeOptionalPath(path);

  if (!normalized) {
    if (input.allowEmpty) {
      return "";
    }

    throw new Error("Path is required.");
  }

  return normalized
    .split("/")
    .map((segment) => normalizeFileName(segment))
    .join("/");
}

export function normalizeLibraryDirectoryPath(path?: string | null): string {
  return normalizeLibraryPath(path, { allowEmpty: true });
}

export function normalizeLibraryFilePath(path: string): string {
  return normalizeLibraryPath(path, { allowEmpty: false });
}

export function ensureLibraryFilePathHasExtension(path: string): string {
  const normalized = normalizeLibraryFilePath(path);
  const fileName = normalized.split("/").pop() ?? normalized;
  const extensionError = getLibraryFileNameExtensionError(fileName);

  if (extensionError !== null) {
    throw new Error(extensionError);
  }

  return normalized;
}

export function normalizeContentType(contentType: string): string {
  const normalized = contentType.trim();
  return normalized || "application/octet-stream";
}

export function chooseUploadStrategy(size: number): FileUploadStrategy {
  return size > SINGLE_PUT_THRESHOLD_BYTES ? "multipart" : "single_put";
}

export function choosePartSize(size: number): number {
  const basePartSize = Math.max(
    DEFAULT_MULTIPART_PART_SIZE_BYTES,
    Math.ceil(size / 10_000 / MIN_MULTIPART_PART_SIZE_BYTES) * MIN_MULTIPART_PART_SIZE_BYTES,
  );

  return Math.max(basePartSize, MIN_MULTIPART_PART_SIZE_BYTES);
}

export type FileScopeId = AccountId | AppId | SessionId | null;
export type FileOwnerId = AccountId | AppId | SessionId;

export function createScope(scopeKind: FileScopeKind, scopeId: FileScopeId): FileScope {
  return {
    id: scopeId,
    kind: scopeKind,
  };
}

export const SESSION_RESOURCE_RECORD_DIR = "attachment";
export const SESSION_RESOURCE_MOUNT_DIR = "session-files";
export const SESSION_ARTIFACT_RECORD_DIR = "artifact";
export const SESSION_ARTIFACT_MATERIALIZED_DIR = "session-artifacts";
export const ACCOUNT_AVATAR_RECORD_DIR = "avatar";

export function createAttachmentPath(fileId: FileId, fileName: string): string {
  return `${SESSION_RESOURCE_RECORD_DIR}/${fileId}/${normalizeFileName(fileName)}`;
}

export function createAccountAvatarPath(fileId: FileId, fileName: string): string {
  return `${ACCOUNT_AVATAR_RECORD_DIR}/${fileId}/${normalizeFileName(fileName)}`;
}

export function createSessionArtifactPath(fileId: FileId, fileName: string): string {
  return `${SESSION_ARTIFACT_RECORD_DIR}/${fileId}/${normalizeFileName(fileName)}`;
}

export function createSessionFilePath(fileId: FileId, fileName: string): string {
  return `${SESSION_RESOURCE_MOUNT_DIR}/${fileId}/${normalizeFileName(fileName)}`;
}

function readSessionResourcePathParts(fileRecordPath: string): {
  fileId: FileId;
  fileName: string;
  kind: FileSessionKind;
} {
  const segments = fileRecordPath.split("/");
  const [root, fileId, fileName] = segments;
  const kind =
    root === SESSION_ARTIFACT_RECORD_DIR || root === SESSION_ARTIFACT_MATERIALIZED_DIR
      ? "artifact"
      : root === SESSION_RESOURCE_RECORD_DIR || root === SESSION_RESOURCE_MOUNT_DIR
        ? "attachment"
        : null;

  if (segments.length !== 3 || kind === null || fileId === undefined || fileName === undefined) {
    throw new Error(
      "Session file path must be attachment/<fileId>/<fileName> or artifact/<fileId>/<fileName>.",
    );
  }

  const normalizedFileId = parsePlatformId<FileId>(fileId, "Session resource file ID");

  if (normalizedFileId !== fileId) {
    throw new Error("Session resource file ID must be normalized.");
  }

  const normalizedFileName = normalizeFileName(fileName);

  if (normalizedFileName !== fileName) {
    throw new Error("Session resource file name must be normalized.");
  }

  return {
    fileId: normalizedFileId,
    fileName: normalizedFileName,
    kind,
  };
}

export function toSessionResourceMaterializedPath(fileRecordPath: string): string {
  const { fileId, fileName, kind } = readSessionResourcePathParts(fileRecordPath);
  const root = kind === "artifact" ? SESSION_ARTIFACT_MATERIALIZED_DIR : SESSION_RESOURCE_MOUNT_DIR;

  return `${root}/${fileId}/${fileName}`;
}

export interface FileObjectKeyInput {
  id: FileId;
  name: string;
  path: string;
  scope: FileScope;
  sessionKind?: FileSessionKind | null;
}

function requireNormalizedProjectionValue(
  value: string,
  normalized: string,
  fieldName: string,
): string {
  if (value !== normalized) {
    throw new Error(`${fieldName} must be normalized before object key projection.`);
  }

  return normalized;
}

function requireProjectionFileName(name: string): string {
  return requireNormalizedProjectionValue(name, normalizeFileName(name), "File name");
}

function requireProjectionLibraryFilePath(path: string): string {
  return requireNormalizedProjectionValue(
    path,
    normalizeLibraryFilePath(path),
    "Library file path",
  );
}

export function createFileObjectKey(file: FileObjectKeyInput): string {
  if (file.scope.kind === "library") {
    return `library/${file.id}/${requireProjectionLibraryFilePath(file.path)}`;
  }

  const fileName = requireProjectionFileName(file.name);

  if (file.scope.kind === "account") {
    return `account/${file.scope.id}/${ACCOUNT_AVATAR_RECORD_DIR}/${file.id}/${fileName}`;
  }

  if (file.scope.kind === "app_draft") {
    return `app-draft/${file.scope.id}/attachment/${file.id}/${fileName}`;
  }

  if (file.scope.kind === "agent_package") {
    return `agent-package/${file.scope.id}/attachment/${file.id}/${fileName}`;
  }

  const sessionRoot =
    file.sessionKind === "artifact" ? SESSION_ARTIFACT_RECORD_DIR : SESSION_RESOURCE_RECORD_DIR;
  return `session/${file.scope.id}/${sessionRoot}/${file.id}/${fileName}`;
}

export function createFileRecordObjectKey(file: FileRecord): string {
  return createFileObjectKey(file);
}

export function createDownloadDisposition(
  name: string,
  disposition: "attachment" | "inline",
): string {
  const normalizedName = normalizeFileName(name).replaceAll('"', "");

  if (!normalizedName) {
    throw new Error("File name is required.");
  }

  return `${disposition}; filename="${normalizedName}"`;
}

export type FileErrorCode =
  | "file_conflict"
  | "file_delete_failed"
  | "file_forbidden"
  | "file_invalid_request"
  | "file_move_failed"
  | "file_not_found"
  | "file_precondition_failed"
  | "file_storage_unavailable"
  | "file_unauthorized"
  | "file_upload_content_missing"
  | "file_upload_expired"
  | "file_upload_integrity_failed"
  | "file_upload_invalid_part"
  | "file_upload_invalid_state";

export type FileApiErrorDetailValue = boolean | number | string | null;
export type FileApiErrorDetails = Record<string, FileApiErrorDetailValue | undefined>;

export interface FileErrorPayload {
  code: FileErrorCode;
  details: FileApiErrorDetails;
  message: string;
  retryable: boolean;
  status: number;
}

export interface FileErrorResponse {
  error: FileErrorPayload;
}

export interface FileScope {
  id: FileScopeId;
  kind: FileScopeKind;
}

export interface FileOwner {
  id: FileOwnerId;
  kind: FileOwnerKind;
}

export interface FileRecord {
  createdAt: string;
  createdBy: AccountId;
  etag: string | null;
  expiresAt: string | null;
  id: FileId;
  mimeType: string | null;
  name: string;
  owner: FileOwner;
  path: string;
  purpose: FilePurpose;
  scope: FileScope;
  sessionKind: FileSessionKind | null;
  sourcePath: string | null;
  size: number;
  status: FileStatus;
  updatedAt: string;
  version: number;
}

export interface FileEntry {
  createdAt: string;
  createdBy: AccountId;
  etag: string | null;
  expiresAt: string | null;
  id: FileId;
  mimeType: string | null;
  name: string;
  path: string;
  sessionKind: FileSessionKind | null;
  size: number;
  status: FileStatus;
  updatedAt: string;
  version: number;
}

export interface FileListQuery {
  appId: AppId;
  scopeId?: FileScopeId;
  scopeKind?: FileScopeKind;
  sessionId?: SessionId;
  sessionKind?: FileSessionKind | null;
  status?: FileStatus;
}

export interface FileListing {
  files: FileRecord[];
}

export interface FileEntryListing {
  files: FileEntry[];
}

export interface CreateAccountAvatarUploadTarget {
  id: AccountId;
  kind: "account";
  name: string;
}

export interface CreateLibraryFileUploadTarget {
  id: AppId;
  kind: "library";
  path: string;
}

export interface CreateSessionFileUploadTarget {
  id: SessionId;
  kind: "session";
  name: string;
  appId: AppId;
}

export interface CreateAppDraftFileUploadTarget {
  id: AppId;
  kind: "app_draft";
  name: string;
}

export interface CreateAgentPackageFileUploadTarget {
  id: AppId;
  kind: "agent_package";
  name: string;
}

export type CreateFileUploadTarget =
  | CreateAccountAvatarUploadTarget
  | CreateSessionFileUploadTarget
  | CreateLibraryFileUploadTarget
  | CreateAgentPackageFileUploadTarget
  | CreateAppDraftFileUploadTarget;

export interface CreateFileUploadRequest {
  file: {
    contentType: string;
    name: string;
    size: number;
  };
  ifMatchEtag?: string;
  overwrite?: boolean;
  purpose: FilePurpose;
  target: CreateFileUploadTarget;
}

export interface FileUploadSummary {
  contentType: string;
  expectedSize: number;
  expiresAt: string;
  fileId: FileId;
  partSize: number | null;
  path: string;
  status: FileUploadStatus;
  strategy: FileUploadStrategy;
}

export type CreateFileUploadResponse = FileUploadSummary;

export interface CompleteFileUploadPart {
  etag: string;
  partNumber: number;
}

export interface CompleteFileUploadRequest {
  parts?: CompleteFileUploadPart[];
}

export interface CompleteFileUploadResponse {
  file: FileEntry;
}

export interface UploadFilePartResponse {
  etag: string;
  partNumber: number;
}

export interface CreateFileDownloadResponse {
  method: "GET";
  url: string;
}

export interface UpdateFileRequest {
  ifMatchEtag?: string;
  ifMatchVersion: number;
  overwrite?: boolean;
  path: string;
}
