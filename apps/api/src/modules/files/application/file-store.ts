import { toSessionResourceMaterializedPath } from "@mosoo/contracts/file";
import type {
  CompleteFileUploadRequest,
  CompleteFileUploadResponse,
  CreateFileDownloadResponse,
  CreateFileUploadRequest,
  CreateFileUploadResponse,
  FileEntry,
  FileListing,
  FileListQuery,
  FileRecord,
  FileScope,
  UpdateFileRequest,
  UploadFilePartResponse,
} from "@mosoo/contracts/file";
import type {
  AddSessionResourceInput,
  RemoveSessionResourceInput,
  SessionFile,
  SessionResource,
} from "@mosoo/contracts/session";
import { fileRecordsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, FileId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { publishSessionResourceUpsert as publishSessionResourceUpsertEvent } from "../../sessions/application/session-resource-events.service";
import {
  claimAppDraftFilesToSession,
  ensureAppDraftFilesClaimable,
} from "../infrastructure/draft-file-service";
import { streamFileContent } from "../infrastructure/file-content-service";
import { deleteAccessibleFile, deleteFileScope } from "../infrastructure/file-delete";
import {
  createFileErrorResponse,
  createFileConflictError,
  createFileInvalidRequestError,
  createFileNotFoundError,
  createUnexpectedFileError,
  FileControlError,
} from "../infrastructure/file-errors";
import {
  createFinalObjectKey,
  createSessionArtifactPath,
  normalizeContentType,
  normalizeFileName,
} from "../infrastructure/file-paths";
import {
  ensureFileAccess,
  fileRecordRowColumns,
  listFileRecords,
  listFileRecordsById,
  toFileEntry,
  toFileRecord,
  toSessionFile,
} from "../infrastructure/file-record-store";
import { updateFile } from "../infrastructure/file-update";
import { completeFileUpload as completeFileUploadRecord } from "../infrastructure/file-upload-complete";
import { createFileUpload, getFileUpload } from "../infrastructure/file-upload-create";
import {
  abortFileUpload,
  uploadFileContent,
  uploadFilePart,
} from "../infrastructure/file-upload-transfer";
import { putObject } from "../infrastructure/r2-s3-client";
import { normalizeR2Etag } from "../infrastructure/r2-s3-client";
import { ensureAppSessionFileAccess } from "../infrastructure/session-file-ownership";

export type ContentBody = ReadableStream<Uint8Array> | null;

const SESSION_RESOURCE_LIMIT = 100;

export interface CompleteFileUploadCommand {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}

export interface RuntimeOutputFileInput {
  bindings: ApiBindings;
  body: Uint8Array;
  contentSha256?: string;
  contentType?: string | null;
  createdBy: AccountId;
  path: string;
  sessionId: SessionId;
}

export interface AgentPackageFileAdmissionInput {
  appId: AppId;
  fileId: FileId;
}

export interface AdmittedAgentPackageFile {
  id: FileId;
  name: string;
  size: number;
}

export interface SessionResourcePathEntry {
  id: FileId;
  name: string;
  path: string;
  size: number;
}

export interface FileStore {
  abortUpload(bindings: ApiBindings, viewer: AuthenticatedViewer, fileId: FileId): Promise<void>;
  admitAgentPackageFile(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    input: AgentPackageFileAdmissionInput,
  ): Promise<AdmittedAgentPackageFile>;
  claimToSession(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    sessionId: SessionId,
    fileIds: FileId[],
  ): Promise<FileRecord[]>;
  completeUpload(command: CompleteFileUploadCommand): Promise<CompleteFileUploadResponse>;
  createSessionResourceUpload(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    input: AddSessionResourceInput,
  ): Promise<CreateFileUploadResponse>;
  createDownload(
    fileId: FileId,
    disposition: "attachment" | "inline",
  ): Promise<CreateFileDownloadResponse>;
  createUpload(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    request: CreateFileUploadRequest,
  ): Promise<CreateFileUploadResponse>;
  delete(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
    options?: { ifMatchEtag?: string | null | undefined },
  ): Promise<void>;
  deleteSessionResource(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    input: RemoveSessionResourceInput,
  ): Promise<SessionResource>;
  deleteScope(bindings: ApiBindings, scope: FileScope): Promise<void>;
  ensureClaimable(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    sessionId: SessionId,
    fileIds: FileId[],
  ): Promise<void>;
  ensureSessionAttachments(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    sessionId: SessionId,
    fileIds: FileId[],
  ): Promise<FileRecord[]>;
  getRecord(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
  ): Promise<FileRecord>;
  getUpload(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
  ): Promise<CreateFileUploadResponse>;
  list(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    query: FileListQuery,
  ): Promise<FileListing>;
  listReadySessionArtifactKeys(database: D1Database, sessionId: SessionId): Promise<string[]>;
  listReadySessionFiles(database: D1Database, sessionId: SessionId): Promise<SessionFile[]>;
  listSessionResourcePathEntries(
    database: D1Database,
    sessionId: SessionId,
    fileIds?: readonly FileId[],
  ): Promise<SessionResourcePathEntry[]>;
  listSessionResources(database: D1Database, sessionId: SessionId): Promise<SessionResource[]>;
  putContent(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
    body: ContentBody,
  ): Promise<void>;
  putPart(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
    partNumber: number,
    body: ContentBody,
  ): Promise<UploadFilePartResponse>;
  recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord>;
  streamContent(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
    disposition?: "attachment" | "inline",
  ): Promise<Response>;
  update(
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    fileId: FileId,
    request: UpdateFileRequest,
  ): Promise<FileEntry>;
}

async function publishSessionResourceUpsert(
  bindings: ApiBindings,
  file: FileRecord,
): Promise<void> {
  await publishSessionResourceUpsertEvent(bindings, file);
}

function readRuntimeOutputPathSegments(path: string): string[] {
  const normalizedPath = path.trim().replaceAll("\\", "/");
  const segments = normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(normalizeFileName);

  if (segments.length === 0) {
    throw createFileInvalidRequestError("Runtime output path must include a file name.");
  }

  return segments;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : Uint8Array.from(bytes).buffer;
}

export function getRuntimeOutputName(path: string): string {
  const name = readRuntimeOutputPathSegments(path).at(-1);

  if (name === undefined) {
    throw createFileInvalidRequestError("Runtime output path must include a file name.");
  }

  return name;
}

export async function createRuntimeOutputContentSha256(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRuntimeOutputParentPath(path: string, contentSha256: string): string {
  return ["runtime-output", ...readRuntimeOutputPathSegments(path), contentSha256].join("/");
}

function toSessionResource(file: FileRecord): SessionResource {
  return {
    createdAt: file.createdAt,
    id: file.id,
    kind: file.sessionKind ?? "attachment",
    mimeType: file.mimeType,
    name: file.name,
    path: toSessionResourceMaterializedPath(file.path),
    size: file.size,
  };
}

async function hasReachedSessionResourceLimit(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const row =
    (await getAppDatabase(database)
      .select({ id: fileRecordsTable.id })
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, "session"),
          eq(fileRecordsTable.scopeId, sessionId),
          eq(fileRecordsTable.sessionKind, "attachment"),
          inArray(fileRecordsTable.status, ["pending", "ready"]),
        ),
      )
      .orderBy(asc(fileRecordsTable.id))
      .limit(1)
      .offset(SESSION_RESOURCE_LIMIT - 1)
      .get()) ?? null;

  return row !== null;
}

async function getSessionAppId(database: D1Database, sessionId: SessionId): Promise<AppId> {
  const row =
    (await getAppDatabase(database)
      .select({ appId: sessionsTable.appId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw createFileNotFoundError("Session not found.");
  }

  return parsePlatformId<AppId>(row.appId, "session app ID");
}

async function loadClaimContext(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
): Promise<{ appId: AppId; viewerId: AccountId }> {
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer ID");
  const appId = await getSessionAppId(bindings.DB, sessionId);

  await ensureAppSessionFileAccess(bindings.DB, viewerId, {
    appId,
    sessionId,
  });

  return { appId, viewerId };
}

async function createUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  request: CreateFileUploadRequest,
): Promise<CreateFileUploadResponse> {
  return createFileUpload(bindings, viewer, request);
}

async function createSessionResourceUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
): Promise<CreateFileUploadResponse> {
  if (await hasReachedSessionResourceLimit(bindings.DB, input.sessionId)) {
    throw createFileConflictError("Session File limit reached. Remove a file before uploading.");
  }

  return createUpload(bindings, viewer, {
    file: input.file,
    overwrite: false,
    purpose: "session_attachment",
    target: {
      id: input.sessionId,
      kind: "session",
      name: input.file.name,
      appId: input.appId,
    },
  });
}

async function getUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
): Promise<CreateFileUploadResponse> {
  return getFileUpload(bindings, viewer, fileId);
}

async function putContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  body: ContentBody,
): Promise<void> {
  await uploadFileContent(bindings, viewer, fileId, body);
}

async function putPart(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  partNumber: number,
  body: ContentBody,
): Promise<UploadFilePartResponse> {
  return uploadFilePart(bindings, viewer, fileId, partNumber, body);
}

async function abortUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
): Promise<void> {
  await abortFileUpload(bindings, viewer, fileId);
}

async function completeUpload(
  command: CompleteFileUploadCommand,
): Promise<CompleteFileUploadResponse> {
  const result = await completeFileUploadRecord(command);

  if (result.file.scope.kind === "session") {
    await publishSessionResourceUpsert(command.bindings, result.file);
  }

  return {
    file: toFileEntry(result.file),
  };
}

async function getRecord(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
): Promise<FileRecord> {
  return toFileRecord(
    await ensureFileAccess({
      database: bindings.DB,
      fileId,
      requiredIntent: "view",
      viewer,
    }),
  );
}

async function streamContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  disposition: "attachment" | "inline" = "attachment",
): Promise<Response> {
  return streamFileContent(bindings, viewer, fileId, disposition);
}

async function createDownload(
  fileId: FileId,
  disposition: "attachment" | "inline",
): Promise<CreateFileDownloadResponse> {
  return {
    method: "GET",
    url: `/api/files/${fileId}/content?disposition=${encodeURIComponent(disposition)}`,
  };
}

async function admitAgentPackageFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AgentPackageFileAdmissionInput,
): Promise<AdmittedAgentPackageFile> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);

  const file =
    (await getAppDatabase(bindings.DB)
      .select({
        createdBy: fileRecordsTable.createdByAccountId,
        expiresAtMs: fileRecordsTable.expiresAt,
        id: fileRecordsTable.id,
        name: fileRecordsTable.name,
        ownerId: fileRecordsTable.ownerId,
        ownerKind: fileRecordsTable.ownerKind,
        purpose: fileRecordsTable.purpose,
        scopeId: fileRecordsTable.scopeId,
        scopeKind: fileRecordsTable.scopeKind,
        size: fileRecordsTable.size,
        status: fileRecordsTable.status,
      })
      .from(fileRecordsTable)
      .where(eq(fileRecordsTable.id, input.fileId))
      .limit(1)
      .get()) ?? null;

  if (file === null) {
    throw new Error("Agent package file was not found.");
  }

  if (file.purpose !== "agent_package") {
    throw new Error("Agent package file purpose must be agent_package.");
  }

  if (file.scopeKind !== "agent_package") {
    throw new Error("Agent package file must use the agent_package scope.");
  }

  if (file.scopeId !== input.appId || file.ownerKind !== "app" || file.ownerId !== input.appId) {
    throw new Error("Agent package file does not belong to the target App.");
  }

  if (file.createdBy !== viewer.id) {
    throw new Error("Agent package file does not belong to the importing user.");
  }

  if (file.status !== "ready") {
    throw new Error("Agent package file is not ready.");
  }

  if (file.expiresAtMs === null || file.expiresAtMs <= currentTimestampMs()) {
    throw new Error("Agent package file is expired.");
  }

  return {
    id: file.id,
    name: file.name,
    size: file.size,
  };
}

async function list(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  query: FileListQuery,
): Promise<FileListing> {
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer ID");
  const appId = parsePlatformId<AppId>(query.appId, "file list app ID");
  const sessionId =
    query.sessionId === undefined
      ? undefined
      : parsePlatformId<SessionId>(query.sessionId, "file list session ID");

  await ensureAppOwnership(bindings.DB, viewerId, appId);

  if (sessionId !== undefined) {
    await ensureAppSessionFileAccess(bindings.DB, viewerId, {
      appId,
      sessionId,
    });
  }

  const rows = await listVisibleFileRecords(bindings.DB, viewerId, appId, query, sessionId);
  return { files: rows.map(toFileRecord) };
}

function visibleSessionFilesCondition(
  viewerId: AccountId,
  appId: AppId,
  sessionId?: SessionId,
): SQL {
  const conditions: SQL[] = [
    eq(fileRecordsTable.scopeKind, "session"),
    eq(fileRecordsTable.scopeId, sessionsTable.id),
    eq(sessionsTable.appId, appId),
    or(eq(sessionsTable.creatorAccountId, viewerId), eq(sessionsTable.attributedUserId, viewerId))!,
  ];

  if (sessionId !== undefined) {
    conditions.push(eq(fileRecordsTable.scopeId, sessionId));
  }

  return and(...conditions)!;
}

function visibleLibraryFilesCondition(appId: AppId): SQL {
  return and(
    eq(fileRecordsTable.scopeKind, "library"),
    eq(fileRecordsTable.scopeId, appId),
    eq(fileRecordsTable.ownerKind, "app"),
    eq(fileRecordsTable.ownerId, appId),
  )!;
}

async function listVisibleFileRecords(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  query: FileListQuery,
  sessionId?: SessionId,
) {
  if (
    query.scopeKind !== undefined &&
    query.scopeKind !== "library" &&
    query.scopeKind !== "session"
  ) {
    throw createFileInvalidRequestError("Only library and session file listing are supported.");
  }

  const conditions: SQL[] = [eq(fileRecordsTable.status, query.status ?? "ready")];

  if (query.sessionKind !== undefined && query.sessionKind !== null) {
    conditions.push(eq(fileRecordsTable.sessionKind, query.sessionKind));
  }

  if (query.scopeKind === "library") {
    conditions.push(visibleLibraryFilesCondition(appId));
  } else if (query.scopeKind === "session" || sessionId !== undefined) {
    conditions.push(visibleSessionFilesCondition(viewerId, appId, sessionId));
  } else {
    conditions.push(
      or(visibleLibraryFilesCondition(appId), visibleSessionFilesCondition(viewerId, appId))!,
    );
  }

  return getAppDatabase(database)
    .select(fileRecordRowColumns)
    .from(fileRecordsTable)
    .leftJoin(sessionsTable, eq(fileRecordsTable.scopeId, sessionsTable.id))
    .where(and(...conditions))
    .orderBy(desc(fileRecordsTable.createdAt), desc(fileRecordsTable.id))
    .all();
}

async function listReadySessionFiles(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionFile[]> {
  const rows = await getAppDatabase(database)
    .select(fileRecordRowColumns)
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionId),
        eq(fileRecordsTable.status, "ready"),
      ),
    )
    .orderBy(desc(fileRecordsTable.createdAt))
    .all();

  return rows.map(toSessionFile);
}

async function listReadySessionArtifactKeys(
  database: D1Database,
  sessionId: SessionId,
): Promise<string[]> {
  const rows = await getAppDatabase(database)
    .select({
      parentPath: fileRecordsTable.parentPath,
    })
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionId),
        eq(fileRecordsTable.status, "ready"),
        eq(fileRecordsTable.sessionKind, "artifact"),
      ),
    )
    .all();

  return rows.map((row) => row.parentPath);
}

async function listSessionResources(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionResource[]> {
  const rows = await listFileRecords(database, {
    scopeId: sessionId,
    scopeKind: "session",
  });

  return rows.map(toFileRecord).map(toSessionResource);
}

async function listSessionResourcePathEntries(
  database: D1Database,
  sessionId: SessionId,
  fileIds?: readonly FileId[],
): Promise<SessionResourcePathEntry[]> {
  if (fileIds !== undefined && fileIds.length === 0) {
    return [];
  }

  const conditions: SQL[] = [
    eq(fileRecordsTable.scopeKind, "session"),
    eq(fileRecordsTable.scopeId, sessionId),
    eq(fileRecordsTable.status, "ready"),
    eq(fileRecordsTable.sessionKind, "attachment"),
  ];

  if (fileIds !== undefined) {
    conditions.push(inArray(fileRecordsTable.id, [...new Set(fileIds)]));
  }

  const results = await getAppDatabase(database)
    .select({
      id: fileRecordsTable.id,
      name: fileRecordsTable.name,
      path: fileRecordsTable.path,
      size: fileRecordsTable.size,
    })
    .from(fileRecordsTable)
    .where(and(...conditions))
    .orderBy(asc(fileRecordsTable.createdAt))
    .all();

  const entries = results.map((row) => ({
    id: row.id,
    name: row.name,
    path: toSessionResourceMaterializedPath(row.path),
    size: row.size,
  }));

  if (fileIds === undefined) {
    return entries;
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  return fileIds.map((fileId) => {
    const entry = entriesById.get(fileId);

    if (entry === undefined) {
      throw createFileNotFoundError(`Attachment ${fileId} is not available for this session.`);
    }

    return entry;
  });
}

async function update(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  request: UpdateFileRequest,
): Promise<FileEntry> {
  return toFileEntry(await updateFile(bindings, viewer, fileId, request));
}

async function deleteFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  options: { ifMatchEtag?: string | null | undefined } = {},
): Promise<void> {
  await deleteAccessibleFile(bindings, viewer, fileId, options);
}

async function deleteSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RemoveSessionResourceInput,
): Promise<SessionResource> {
  const file = await getRecord(bindings, viewer, input.resourceId);

  if (
    file.scope.kind !== "session" ||
    file.scope.id !== input.sessionId ||
    file.sessionKind !== "attachment"
  ) {
    throw createFileNotFoundError("Session resource not found.");
  }

  await deleteFile(bindings, viewer, input.resourceId);
  return toSessionResource(file);
}

async function deleteScope(bindings: ApiBindings, scope: FileScope): Promise<void> {
  await deleteFileScope(bindings, {
    scopeId: scope.id,
    scopeKind: scope.kind,
  });
}

async function ensureClaimable(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
  fileIds: FileId[],
): Promise<void> {
  if (fileIds.length === 0) {
    return;
  }

  const { appId } = await loadClaimContext(bindings, viewer, sessionId);
  await ensureAppDraftFilesClaimable(bindings, viewer, {
    appId,
    attachmentIds: fileIds,
  });
}

async function claimToSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
  fileIds: FileId[],
): Promise<FileRecord[]> {
  if (fileIds.length === 0) {
    return [];
  }

  const { appId } = await loadClaimContext(bindings, viewer, sessionId);
  await claimAppDraftFilesToSession(bindings, viewer, {
    appId,
    attachmentIds: fileIds,
    sessionId,
  });

  const rows = await listFileRecordsById(bindings.DB, fileIds);
  const files = rows.map(toFileRecord);

  await Promise.all(files.map((file) => publishSessionResourceUpsert(bindings, file)));
  return files;
}

async function ensureSessionAttachments(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
  fileIds: FileId[],
): Promise<FileRecord[]> {
  if (fileIds.length === 0) {
    return [];
  }

  const files = await Promise.all(fileIds.map((fileId) => getRecord(bindings, viewer, fileId)));

  return files.map((file, index) => {
    const requestedFileId = fileIds[index];

    if (
      file.scope.kind !== "session" ||
      file.scope.id !== sessionId ||
      file.status !== "ready" ||
      file.sessionKind !== "attachment"
    ) {
      throw createFileNotFoundError(
        `Attachment ${requestedFileId ?? file.id} is not available for this session.`,
      );
    }

    return file;
  });
}

async function recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord> {
  const fileId = createPlatformId<FileId>();
  const name = getRuntimeOutputName(input.path);
  const contentType = normalizeContentType(input.contentType ?? "application/octet-stream");
  const contentSha256 = input.contentSha256 ?? (await createRuntimeOutputContentSha256(input.body));
  const path = createSessionArtifactPath(fileId, name);
  const timestampMs = currentTimestampMs();
  const objectKey = createFinalObjectKey({
    created_by_account_id: input.createdBy,
    id: fileId,
    name,
    path,
    scope_id: input.sessionId,
    scope_kind: "session",
    session_kind: "artifact",
  });
  const object = await putObject({
    bindings: input.bindings,
    body: input.body,
    contentType,
    objectKey,
  });

  await getAppDatabase(input.bindings.DB)
    .insert(fileRecordsTable)
    .values({
      committed: true,
      createdAt: timestampMs,
      createdByAccountId: input.createdBy,
      etag: object.etag,
      expiresAt: null,
      id: fileId,
      mimeType: object.contentType ?? contentType,
      name,
      objectKey,
      ownerId: input.sessionId,
      ownerKind: "session",
      parentPath: createRuntimeOutputParentPath(input.path, contentSha256),
      path,
      purpose: "session_artifact",
      scopeId: input.sessionId,
      scopeKind: "session",
      sessionKind: "artifact",
      size: object.contentLength,
      status: "ready",
      updatedAt: timestampMs,
      version: 1,
    })
    .run();

  const createdRows = await listFileRecordsById(input.bindings.DB, [fileId]);
  const createdRow = createdRows[0];

  if (createdRow === undefined) {
    throw createFileNotFoundError("Runtime output file was not created.");
  }

  const file = toFileRecord(createdRow);
  await publishSessionResourceUpsert(input.bindings, file);
  return file;
}

export {
  createFileErrorResponse,
  createUnexpectedFileError,
  FileControlError,
  normalizeFileName,
  normalizeR2Etag,
};

export const fileStore: FileStore = {
  abortUpload,
  admitAgentPackageFile,
  claimToSession,
  completeUpload,
  createDownload,
  createSessionResourceUpload,
  createUpload,
  delete: deleteFile,
  deleteSessionResource,
  deleteScope,
  ensureClaimable,
  ensureSessionAttachments,
  getRecord,
  getUpload,
  list,
  listReadySessionArtifactKeys,
  listReadySessionFiles,
  listSessionResourcePathEntries,
  listSessionResources,
  putContent,
  putPart,
  recordRuntimeOutput,
  streamContent,
  update,
};
