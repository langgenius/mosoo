import { toSessionResourceMaterializedPath } from "@mosoo/contracts/file";
import type {
  CompleteFileUploadRequest,
  CompleteFileUploadResponse,
  CreateFileUploadResponse,
  FileListing,
  FileListQuery,
  FileRecord,
  FileScope,
} from "@mosoo/contracts/file";
import type { AddSessionResourceInput, SessionFile } from "@mosoo/contracts/session";
import { fileRecordsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, ProjectId, FileId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { toArrayBuffer } from "../../../shared/bytes";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { assertProjectKeyAccess } from "../../auth/domain/project-key-access";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { publishSessionResourceUpsert } from "../../sessions/application/session-resource-events.service";
import {
  claimProjectDraftFilesToSession,
  loadClaimableDraftFiles,
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
import { ensureFileAccess } from "../infrastructure/file-record-access";
import {
  fileRecordRowColumns,
  parseRuntimeOutputSourcePath,
  toFileEntry,
  toFileRecord,
  toSessionFile,
} from "../infrastructure/file-record-model";
import type { FileAccessIntent, FileRecordRow } from "../infrastructure/file-record-model";
import { listFileRecordsById } from "../infrastructure/file-record-queries";
import { completeFileUpload } from "../infrastructure/file-upload-complete";
import { createFileUpload, getFileUpload } from "../infrastructure/file-upload-create";
import {
  abortFileUpload,
  uploadFileContent,
  uploadFilePart,
} from "../infrastructure/file-upload-transfer";
import { ensureSessionFileAccess } from "../infrastructure/session-file-ownership";

const SESSION_RESOURCE_LIMIT = 100;

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

function getRuntimeOutputName(path: string): string {
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

async function requireClaimTargetProjectId(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
  requiredIntent: FileAccessIntent,
): Promise<ProjectId> {
  const session = await ensureSessionFileAccess(
    bindings.DB,
    viewer.id,
    { sessionId },
    requiredIntent,
  );
  assertProjectKeyAccess(viewer, session.project_id);

  return session.project_id;
}

async function createSessionResourceUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
): Promise<CreateFileUploadResponse> {
  if (await hasReachedSessionResourceLimit(bindings.DB, input.sessionId)) {
    throw createFileConflictError("Session File limit reached. Remove a file before uploading.");
  }

  return createFileUpload(bindings, viewer, {
    file: input.file,
    purpose: "session_attachment",
    target: {
      id: input.sessionId,
      kind: "session",
      name: input.file.name,
      projectId: input.projectId,
    },
  });
}

async function completeUpload(command: {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}): Promise<CompleteFileUploadResponse> {
  const file = await completeFileUpload(command);

  if (file.scope.kind === "session") {
    await publishSessionResourceUpsert(command.bindings, file);
  }

  return {
    file: toFileEntry(file),
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

async function admitAgentPackageFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AgentPackageFileAdmissionInput,
): Promise<AdmittedAgentPackageFile> {
  assertProjectKeyAccess(viewer, input.projectId);
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
  assertProjectKeyAccess(viewer, query.projectId);

  if (query.sessionId === undefined) {
    await ensureProjectOwnership(bindings.DB, viewer.id, query.projectId);
  } else {
    await ensureSessionFileAccess(
      bindings.DB,
      viewer.id,
      { projectId: query.projectId, sessionId: query.sessionId },
      "view",
    );
  }

  const rows = await listVisibleFileRecords(bindings.DB, query);
  return { files: rows.map(toFileRecord) };
}

function visibleSessionFilesCondition(projectId: ProjectId, sessionId?: SessionId): SQL {
  return and(
    eq(fileRecordsTable.scopeKind, "session"),
    eq(fileRecordsTable.scopeId, sessionsTable.id),
    eq(sessionsTable.projectId, projectId),
    sessionId === undefined ? undefined : eq(fileRecordsTable.scopeId, sessionId),
  )!;
}

function visibleLibraryFilesCondition(projectId: ProjectId): SQL {
  return and(
    eq(fileRecordsTable.scopeKind, "library"),
    eq(fileRecordsTable.scopeId, projectId),
    eq(fileRecordsTable.ownerKind, "app"),
    eq(fileRecordsTable.ownerId, projectId),
  )!;
}

async function listVisibleFileRecords(database: D1Database, query: FileListQuery) {
  if (
    query.scopeKind !== undefined &&
    query.scopeKind !== "library" &&
    query.scopeKind !== "session"
  ) {
    throw createFileInvalidRequestError("Only library and session file listing are supported.");
  }

  const conditions: SQL[] = [eq(fileRecordsTable.status, "ready")];

  if (query.sessionKind !== undefined && query.sessionKind !== null) {
    conditions.push(eq(fileRecordsTable.sessionKind, query.sessionKind));
  }

  if (query.scopeKind === "library") {
    conditions.push(visibleLibraryFilesCondition(query.projectId));
  } else if (query.scopeKind === "session" || query.sessionId !== undefined) {
    conditions.push(visibleSessionFilesCondition(query.projectId, query.sessionId));
  } else {
    conditions.push(
      or(
        visibleLibraryFilesCondition(query.projectId),
        visibleSessionFilesCondition(query.projectId),
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

async function listLatestReadySessionArtifactSources(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionArtifactSource[]> {
  const rows = await getAppDatabase(database)
    .select({
      id: fileRecordsTable.id,
      createdAt: fileRecordsTable.createdAt,
      objectKey: fileRecordsTable.objectKey,
      parentPath: fileRecordsTable.parentPath,
      size: fileRecordsTable.size,
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
    .orderBy(asc(fileRecordsTable.createdAt), asc(fileRecordsTable.id))
    .all();

  // Ascending scan + map overwrite keeps the newest record per source path
  // (ULID ids break created-at ties in creation order).
  const latestBySourcePath = new Map<string, SessionArtifactSource>();

  for (const row of rows) {
    const sourcePath = parseRuntimeOutputSourcePath(row.parentPath);

    if (sourcePath === null) {
      continue;
    }

    latestBySourcePath.set(sourcePath, {
      objectKey: row.objectKey,
      size: row.size,
      sourcePath,
    });
  }

  return [...latestBySourcePath.values()].toSorted((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
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

async function deleteScope(bindings: ApiBindings, scope: FileScope): Promise<void> {
  await deleteFileScope(bindings, {
    scopeId: scope.id,
    scopeKind: scope.kind,
  });
}

async function ensureClaimable(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  fileIds: FileId[],
): Promise<void> {
  await loadClaimableDraftFiles(bindings.DB, viewer.id, projectId, fileIds);
}

async function claimToSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
  fileIds: FileId[],
  options: { resume?: boolean } = {},
): Promise<FileRecord[]> {
  if (fileIds.length === 0) {
    return [];
  }

  const projectId = await requireClaimTargetProjectId(bindings, viewer, sessionId, "write");
  await claimProjectDraftFilesToSession(bindings, viewer.id, {
    projectId,
    attachmentIds: fileIds,
    sessionId,
    resume: options.resume === true,
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

  await ensureSessionFileAccess(bindings.DB, viewer.id, { sessionId }, "view");

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
  const object = await bindings.FILE_BUCKET.get(objectKey);

  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

async function recordRuntimeOutput(input: RuntimeOutputFileInput): Promise<FileRecord> {
  const fileId = createPlatformId<FileId>();
  const name = getRuntimeOutputName(input.path);
  const contentType = normalizeContentType(input.contentType ?? "application/octet-stream");
  const contentSha256 = input.contentSha256 ?? (await createRuntimeOutputContentSha256(input.body));
  const path = createSessionArtifactPath(fileId, name);
  const timestampMs = currentTimestampMs();
  const objectKey = createFinalObjectKey({
    id: fileId,
    name,
    path,
    scope_id: input.sessionId,
    scope_kind: "session",
    session_kind: "artifact",
  });
  const object = await input.bindings.FILE_BUCKET.put(objectKey, input.body, {
    httpMetadata: {
      contentType,
    },
  });
  const row: FileRecordRow = {
    committed: 1,
    created_at: timestampMs,
    created_by_account_id: input.createdBy,
    etag: object.etag,
    expires_at: null,
    id: fileId,
    mime_type: object.httpMetadata?.contentType ?? contentType,
    name,
    object_key: objectKey,
    owner_id: input.sessionId,
    owner_kind: "session",
    parent_path: createRuntimeOutputParentPath(input.path, contentSha256),
    path,
    purpose: "session_artifact",
    scope_id: input.sessionId,
    scope_kind: "session",
    session_kind: "artifact",
    size: object.size,
    status: "ready",
    updated_at: timestampMs,
    version: 1,
  };

  await getAppDatabase(input.bindings.DB)
    .insert(fileRecordsTable)
    .values({
      committed: true,
      createdAt: row.created_at,
      createdByAccountId: row.created_by_account_id,
      etag: row.etag,
      expiresAt: row.expires_at,
      id: row.id,
      mimeType: row.mime_type,
      name: row.name,
      objectKey: row.object_key,
      ownerId: row.owner_id,
      ownerKind: row.owner_kind,
      parentPath: row.parent_path,
      path: row.path,
      purpose: row.purpose,
      scopeId: row.scope_id,
      scopeKind: row.scope_kind,
      sessionKind: row.session_kind,
      size: row.size,
      status: row.status,
      updatedAt: row.updated_at,
      version: row.version,
    })
    .run();

  const file = toFileRecord(row);
  await publishSessionResourceUpsert(input.bindings, file);
  return file;
}

export {
  createFileErrorResponse,
  createUnexpectedFileError,
  FileControlError,
  normalizeFileName,
  toFileEntry,
};

export const fileStore = {
  abortUpload: abortFileUpload,
  admitAgentPackageFile,
  claimToSession,
  completeUpload,
  createSessionResourceUpload,
  createUpload: createFileUpload,
  delete: deleteAccessibleFile,
  deleteScope,
  ensureClaimable,
  ensureSessionAttachments,
  getRecord,
  getUpload: getFileUpload,
  list,
  listLatestReadySessionArtifactSources,
  listReadySessionArtifactKeys,
  listReadySessionFiles,
  listSessionResourcePathEntries,
  putContent: uploadFileContent,
  putPart: uploadFilePart,
  readSessionArtifactBytes,
  recordRuntimeOutput,
  streamContent: streamFileContent,
};
