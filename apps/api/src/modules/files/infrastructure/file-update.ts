import { getParentPath } from "@mosoo/contracts/file";
import type { FileRecord, UpdateFileRequest } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createFileConflictError,
  createFileMoveFailedError,
  createFilePreconditionFailedError,
} from "./file-errors";
import { createFinalObjectKey } from "./file-paths";
import {
  deleteFileControlRows,
  ensureFileAccess,
  expirePathLocks,
  getFileRecordById,
  getPendingFileByPath,
  getReadyFileByPath,
  toFileRecord,
} from "./file-record-store";
import { getFileScopeDescriptor } from "./file-scope-descriptor";
import { commitPendingFileVersionSafely, createPendingFileVersion } from "./file-version-store";
import type { PendingFileVersion } from "./file-version-store";
import { copyObject, deleteObject, headObject, normalizeR2Etag } from "./r2-s3-client";

export async function updateFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  input: UpdateFileRequest,
): Promise<FileRecord> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });

  const descriptor = getFileScopeDescriptor(file.scope_kind);

  const moveRename = descriptor.capabilities.moveRename;

  if (!moveRename.enabled) {
    throw createFileConflictError("Only a library file can be moved or renamed.");
  }

  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");

  if (file.status !== "ready") {
    throw createFileConflictError("Only a ready file can be moved.");
  }

  if (file.version !== input.ifMatchVersion) {
    throw createFilePreconditionFailedError("File was changed by someone else, please refresh.");
  }

  const ifMatchEtag = normalizeR2Etag(input.ifMatchEtag);

  if (Boolean(ifMatchEtag) && normalizeR2Etag(file.etag) !== ifMatchEtag) {
    throw createFilePreconditionFailedError("File was changed by someone else, please refresh.");
  }

  const nextPath = moveRename.normalizePath(input.path);

  if (nextPath === file.path) {
    return toFileRecord(file);
  }

  if (descriptor.capabilities.pathLocks) {
    await expirePathLocks({
      database: bindings.DB,
      path: nextPath,
      scopeId: file.scope_id,
      scopeKind: file.scope_kind,
    });
  }

  if (
    await getPendingFileByPath({
      database: bindings.DB,
      path: nextPath,
      scopeId: file.scope_id,
      scopeKind: file.scope_kind,
    })
  ) {
    throw createFileConflictError("A pending upload already exists at the destination path.");
  }

  const existingReady = await getReadyFileByPath({
    database: bindings.DB,
    path: nextPath,
    scopeId: file.scope_id,
    scopeKind: file.scope_kind,
  });

  if (existingReady && existingReady.id !== file.id && !(input.overwrite === true)) {
    throw createFileConflictError("A file already exists at the destination path.");
  }

  const nextName = nextPath.split("/").pop() ?? nextPath;
  const destinationObjectKey = createFinalObjectKey({
    ...file,
    name: nextName,
    path: nextPath,
    scope_id: file.scope_id,
    scope_kind: file.scope_kind,
  });
  const moveCopyOptions: {
    destinationIfMatch?: string;
    destinationIfNoneMatch?: string;
    sourceIfMatch?: string;
  } = {};

  if (!existingReady || existingReady.id === file.id) {
    moveCopyOptions.destinationIfNoneMatch = "*";
  } else if (isTruthy(existingReady.etag)) {
    moveCopyOptions.destinationIfMatch = existingReady.etag;
  }

  const sourceIfMatch = ifMatchEtag ?? normalizeR2Etag(file.etag);

  if (isTruthy(sourceIfMatch)) {
    moveCopyOptions.sourceIfMatch = sourceIfMatch;
  }

  let overwrittenVersion: PendingFileVersion | null = null;

  if (existingReady && existingReady.id !== file.id) {
    overwrittenVersion = await createPendingFileVersion(
      bindings,
      existingReady,
      viewerId,
      "move_overwrite",
    );
  }

  await copyObject({
    bindings,
    destinationObjectKey,
    options: moveCopyOptions,
    sourceObjectKey: file.object_key,
  });

  const destinationHead = await headObject(bindings, destinationObjectKey);

  if (!destinationHead) {
    throw createFileMoveFailedError("Copied object could not be verified.");
  }

  const timestampMs = currentTimestampMs();

  if (existingReady && existingReady.id !== file.id) {
    await deleteFileControlRows(bindings.DB, { fileIds: [existingReady.id] });
  }

  await getAppDatabase(bindings.DB)
    .update(fileRecordsTable)
    .set({
      etag: destinationHead.etag,
      mimeType: destinationHead.contentType,
      name: nextName,
      objectKey: destinationObjectKey,
      parentPath: getParentPath(nextPath),
      path: nextPath,
      scopeId: file.scope_id,
      size: destinationHead.contentLength,
      updatedAt: timestampMs,
      version: sql`${fileRecordsTable.version} + 1`,
    })
    .where(eq(fileRecordsTable.id, file.id))
    .run();

  await deleteObject(bindings, file.object_key, {
    ifMatch: sourceIfMatch ?? undefined,
  }).catch((error: unknown) => {
    logError("file.cleanup.failed.move-source-delete", {
      ...createErrorLogContext(error),
      fileId: file.id,
      objectKey: file.object_key,
    });
  });

  if (existingReady && existingReady.id !== file.id) {
    await deleteObject(bindings, existingReady.object_key, {
      ifMatch: existingReady.etag ?? undefined,
    }).catch((error: unknown) => {
      logError("file.cleanup.failed.move-overwritten-delete", {
        ...createErrorLogContext(error),
        fileId: existingReady.id,
        objectKey: existingReady.object_key,
      });
    });
  }

  const updated = await getFileRecordById(bindings.DB, file.id);

  if (!updated) {
    throw createFileMoveFailedError("Moved file could not be reloaded.");
  }

  await commitPendingFileVersionSafely(bindings, overwrittenVersion, {
    fileId: existingReady?.id,
    nextPath,
    objectKey: existingReady?.object_key,
    previousPath: file.path,
    reason: "move_overwrite",
    scopeId: file.scope_id,
  });

  logInfo(moveRename.eventName, {
    fileId: file.id,
    nextPath,
    overwrite: input.overwrite ?? false,
    previousPath: file.path,
    previousScopeId: file.scope_id,
    scopeId: file.scope_id,
    viewerId,
  });

  return toFileRecord(updated);
}
