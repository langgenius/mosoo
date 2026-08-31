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
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, ProjectId, FileId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, parameterizedSql } from "../../../platform/db/drizzle";
import { toArrayBuffer } from "../../../shared/bytes";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { publishSessionResourceUpsert as publishSessionResourceUpsertEvent } from "../../sessions/application/session-resource-events.service";
import {
  claimProjectDraftFilesToSession,
  ensureProjectDraftFilesClaimable,
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
  isRetryableFileControlError,
} from "../infrastructure/file-errors";
import { normalizeFileName } from "../infrastructure/file-paths";
import {
  ensureFileAccess,
  fileRecordRowColumns,
  listFileRecords,
  listFileRecordsById,
  toFileEntry,
  toFileRecord,
  toSessionFile,
} from "../infrastructure/file-record-store";
import type { FileRecordRow } from "../infrastructure/file-record-store";
import { updateFile } from "../infrastructure/file-update";
import { completeFileUpload as completeFileUploadRecord } from "../infrastructure/file-upload-complete";
import { createFileUpload, getFileUpload } from "../infrastructure/file-upload-create";
import {
  abortFileUpload,
  uploadFileContent,
  uploadFilePart,
} from "../infrastructure/file-upload-transfer";
import { deleteObject, getObjectBody, putObject } from "../infrastructure/r2-s3-client";
import { normalizeR2Etag } from "../infrastructure/r2-s3-client";
import {
  ensureProjectSessionFileAccess,
  ensureSessionFileAccess,
} from "../infrastructure/session-file-ownership";

export type ContentBody = ReadableStream<Uint8Array> | null;

const SESSION_RESOURCE_LIMIT = 100;

export interface CompleteFileUploadCommand {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}

export interface AgentPackageFileAdmissionInput {
  projectId: ProjectId;
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

export interface SessionArtifactSource {
  objectKey: string;
  size: number;
  sourcePath: string;
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
  listLatestReadySessionArtifactSources(
    database: D1Database,
    sessionId: SessionId,
  ): Promise<SessionArtifactSource[]>;
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
  readSessionArtifactBytes(bindings: ApiBindings, objectKey: string): Promise<Uint8Array | null>;
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

export function getRuntimeOutputName(path: string): string {
  const name = readRuntimeOutputPathSegments(path).at(-1);

  if (name === undefined) {
    throw createFileInvalidRequestError("Runtime output path must include a file name.");
  }

  return name;
}

export async function createRuntimeOutputContentSha256(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(body));
  return new Uint8Array(digest).toHex();
}

export function createRuntimeOutputParentPath(path: string, contentSha256: string): string {
  return ["runtime-output", ...readRuntimeOutputPathSegments(path), contentSha256].join("/");
}

export async function putRuntimeArtifactObject(input: {
  bindings: ApiBindings;
  body: Uint8Array;
  contentSha256: string;
  contentType: string;
  objectKey: string;
  sourcePath: string;
  attemptId: string;
}): Promise<{ contentLength: number; contentType: string | null; etag: string } | null> {
  try {
    return await putObject({
      bindings: input.bindings,
      body: input.body,
      contentType: input.contentType,
      customMetadata: {
        attemptId: input.attemptId,
        contentSha256: input.contentSha256,
        sourcePath: input.sourcePath,
      },
      objectKey: input.objectKey,
      options: { ifNoneMatch: "*" },
    });
  } catch (error) {
    if (isRetryableFileControlError(error)) {
      return null;
    }
    throw error;
  }
}

export async function deleteRuntimeArtifactObject(
  bindings: ApiBindings,
  objectKey: string,
): Promise<void> {
  await deleteObject(bindings, objectKey);
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

async function getSessionProjectId(database: D1Database, sessionId: SessionId): Promise<ProjectId> {
  const row =
    (await getAppDatabase(database)
      .select({ projectId: sessionsTable.projectId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw createFileNotFoundError("Session not found.");
  }

  return parsePlatformId<ProjectId>(row.projectId, "session project ID");
}

async function loadClaimContext(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
): Promise<{ projectId: ProjectId; viewerId: AccountId }> {
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer ID");
  const projectId = await getSessionProjectId(bindings.DB, sessionId);

  await ensureProjectSessionFileAccess(bindings.DB, viewerId, {
    projectId,
    sessionId,
  });

  return { projectId, viewerId };
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
      projectId: input.projectId,
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
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);

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

  if (
    file.scopeId !== input.projectId ||
    file.ownerKind !== "app" ||
    file.ownerId !== input.projectId
  ) {
    throw new Error("Agent package file does not belong to the target Project.");
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
  const projectId = parsePlatformId<ProjectId>(query.projectId, "file list project ID");
  const sessionId =
    query.sessionId === undefined
      ? undefined
      : parsePlatformId<SessionId>(query.sessionId, "file list session ID");

  await ensureProjectOwnership(bindings.DB, viewerId, projectId);

  if (sessionId !== undefined) {
    await ensureProjectSessionFileAccess(bindings.DB, viewerId, {
      projectId,
      sessionId,
    });
  }

  const rows = await listVisibleFileRecords(bindings.DB, viewerId, projectId, query, sessionId);
  return { files: rows.map(toFileRecord) };
}

function visibleSessionFilesCondition(
  viewerId: AccountId,
  projectId: ProjectId,
  sessionId?: SessionId,
): SQL {
  const conditions: SQL[] = [
    eq(fileRecordsTable.scopeKind, "session"),
    eq(fileRecordsTable.scopeId, sessionsTable.id),
    eq(sessionsTable.projectId, projectId),
    or(
      eq(sessionsTable.creatorAccountId, viewerId),
      eq(sessionsTable.participantAccountId, viewerId),
    )!,
  ];

  if (sessionId !== undefined) {
    conditions.push(eq(fileRecordsTable.scopeId, sessionId));
  }

  return and(...conditions)!;
}

function visibleLibraryFilesCondition(projectId: ProjectId): SQL {
  return and(
    eq(fileRecordsTable.scopeKind, "library"),
    eq(fileRecordsTable.scopeId, projectId),
    eq(fileRecordsTable.ownerKind, "app"),
    eq(fileRecordsTable.ownerId, projectId),
  )!;
}

async function listVisibleFileRecords(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
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
    conditions.push(visibleLibraryFilesCondition(projectId));
  } else if (query.scopeKind === "session" || sessionId !== undefined) {
    conditions.push(visibleSessionFilesCondition(viewerId, projectId, sessionId));
  } else {
    conditions.push(
      or(
        visibleLibraryFilesCondition(projectId),
        visibleSessionFilesCondition(viewerId, projectId),
      )!,
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

type CurrentSessionArtifactFileRow = Pick<
  FileRecordRow,
  "committed" | "created_at" | "id" | "mime_type" | "name" | "session_kind" | "size"
>;

interface CurrentSessionArtifactSourceRow {
  readonly authority_source_path: string;
  readonly object_key: string;
  readonly size: number;
}

const CURRENT_SESSION_ARTIFACT_AUTHORITY_CTE = `
WITH input(session_id) AS (
  VALUES (?)
),
artifact_authority AS (
  SELECT artifact_head.source_path, artifact_head.file_id
  FROM session_artifact_head AS artifact_head
  INNER JOIN input ON input.session_id = artifact_head.session_id
)`;

const CURRENT_SESSION_ARTIFACT_FILES_SQL = `${CURRENT_SESSION_ARTIFACT_AUTHORITY_CTE}
SELECT
  file_record.committed,
  file_record.created_at,
  file_record.id,
  file_record.mime_type,
  file_record.name,
  file_record.session_kind,
  file_record.size,
  artifact_authority.source_path
FROM artifact_authority
INNER JOIN file_record ON file_record.id = artifact_authority.file_id
INNER JOIN input ON input.session_id = file_record.scope_id
WHERE file_record.scope_kind = 'session'
  AND file_record.session_kind = 'artifact'
  AND file_record.status = 'ready'
ORDER BY file_record.created_at DESC, file_record.id DESC`;

const CURRENT_SESSION_ARTIFACT_SOURCES_SQL = `${CURRENT_SESSION_ARTIFACT_AUTHORITY_CTE}
SELECT
  file_record.object_key,
  file_record.size,
  artifact_authority.source_path AS authority_source_path
FROM artifact_authority
INNER JOIN file_record ON file_record.id = artifact_authority.file_id
INNER JOIN input ON input.session_id = file_record.scope_id
WHERE file_record.scope_kind = 'session'
  AND file_record.session_kind = 'artifact'
  AND file_record.status = 'ready'
ORDER BY artifact_authority.source_path`;

async function listCurrentSessionArtifactFiles(
  database: D1Database,
  sessionId: SessionId,
): Promise<CurrentSessionArtifactFileRow[]> {
  return getAppDatabase(database).all<CurrentSessionArtifactFileRow>(
    parameterizedSql(CURRENT_SESSION_ARTIFACT_FILES_SQL, [sessionId]),
  );
}

async function listCurrentSessionArtifactSources(
  database: D1Database,
  sessionId: SessionId,
): Promise<CurrentSessionArtifactSourceRow[]> {
  return getAppDatabase(database).all<CurrentSessionArtifactSourceRow>(
    parameterizedSql(CURRENT_SESSION_ARTIFACT_SOURCES_SQL, [sessionId]),
  );
}

async function listReadySessionFiles(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionFile[]> {
  const db = getAppDatabase(database);
  const [rows, artifacts] = await Promise.all([
    db
      .select(fileRecordRowColumns)
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, "session"),
          eq(fileRecordsTable.scopeId, sessionId),
          eq(fileRecordsTable.status, "ready"),
          sql`${fileRecordsTable.sessionKind} IS NOT 'artifact'`,
        ),
      )
      .all(),
    listCurrentSessionArtifactFiles(database, sessionId),
  ]);

  return [...rows, ...artifacts]
    .toSorted(
      (left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id),
    )
    .map(toSessionFile);
}

async function listLatestReadySessionArtifactSources(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionArtifactSource[]> {
  const rows = await listCurrentSessionArtifactSources(database, sessionId);
  return rows
    .map((row) => ({
      objectKey: row.object_key,
      size: row.size,
      sourcePath: row.authority_source_path,
    }))
    .toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath));
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

  const { projectId } = await loadClaimContext(bindings, viewer, sessionId);
  await ensureProjectDraftFilesClaimable(bindings, viewer, {
    projectId,
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

  const { projectId } = await loadClaimContext(bindings, viewer, sessionId);
  await claimProjectDraftFilesToSession(bindings, viewer, {
    projectId,
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

  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer ID");
  await ensureSessionFileAccess(bindings.DB, viewerId, sessionId);

  const rows = await listFileRecordsById(bindings.DB, fileIds);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const files: FileRecord[] = [];

  for (const fileId of fileIds) {
    const row = rowsById.get(fileId);
    const file = row === undefined ? null : toFileRecord(row);

    if (
      file === null ||
      file.scope.kind !== "session" ||
      file.scope.id !== sessionId ||
      file.status !== "ready" ||
      file.sessionKind !== "attachment"
    ) {
      throw createFileNotFoundError(`Attachment ${fileId} is not available for this session.`);
    }

    files.push(file);
  }

  return files;
}

// Internal runtime read for artifact re-materialization; artifact object keys
// come from this module's own session-artifact records, not caller input.
async function readSessionArtifactBytes(
  bindings: ApiBindings,
  objectKey: string,
): Promise<Uint8Array | null> {
  const body = await getObjectBody(bindings, objectKey);

  return body === null ? null : new Uint8Array(await body.arrayBuffer());
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
  listLatestReadySessionArtifactSources,
  listReadySessionFiles,
  listSessionResourcePathEntries,
  listSessionResources,
  putContent,
  putPart,
  readSessionArtifactBytes,
  streamContent,
  update,
};
