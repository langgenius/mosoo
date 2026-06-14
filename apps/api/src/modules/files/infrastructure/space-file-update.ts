import { getParentPath } from "@mosoo/contracts/file";
import type { FileRecord, UpdateFileRequest } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SpaceId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createFileConflictError,
  createFileForbiddenError,
  createFileMoveFailedError,
  createFilePreconditionFailedError,
} from "./file-errors";
import { ensureSpaceFilePathHasExtension } from "./file-paths";
import {
  deleteFileControlRows,
  expirePathLocks,
  getFileRecordById,
  getPendingFileByPath,
  getReadyFileByPath,
  toFileRecord,
} from "./file-record-store";
import { copyObject, deleteObject, headObject, normalizeR2Etag } from "./r2-s3-client";
import { ensureSpaceAccessBySpaceId } from "./space-access";
import { ensureSpaceParentDirectories } from "./space-directory-store";
import { ensureSpaceFileWriteUnlocked } from "./space-file-lock";
import {
  commitPendingSpaceFileVersionSafely,
  createPendingSpaceFileVersion,
} from "./space-file-version-store";
import type { PendingSpaceFileVersion } from "./space-file-version-store";
export async function updateSpaceFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  input: UpdateFileRequest,
): Promise<FileRecord> {
  const file = await getFileRecordById(bindings.DB, fileId);

  if (!file) {
    throw createFileConflictError("File not found.");
  }

  if (file.scope_kind !== "space") {
    throw createFileConflictError("Only a space file can be moved or renamed.");
  }

  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const sourceSpaceId: SpaceId = parsePlatformId(file.scope_id, "file space ID");
  const sourceSpace = await ensureSpaceAccessBySpaceId(
    bindings.DB,
    viewerId,
    sourceSpaceId,
    "edit",
  );

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

  const targetSpaceId: SpaceId =
    input.targetSpaceId === undefined
      ? sourceSpaceId
      : parsePlatformId(input.targetSpaceId, "target space ID");

  if (targetSpaceId !== sourceSpaceId) {
    const targetSpace = await ensureSpaceAccessBySpaceId(
      bindings.DB,
      viewerId,
      targetSpaceId,
      "edit",
    );

    if (targetSpace.app_id !== sourceSpace.app_id) {
      throw createFileForbiddenError("Cannot move space files across Apps.");
    }
  }

  await ensureSpaceFileWriteUnlocked(bindings, viewer, sourceSpaceId, file.path);

  const nextPath = ensureSpaceFilePathHasExtension(input.path);

  if (targetSpaceId === sourceSpaceId && nextPath === file.path) {
    return toFileRecord(file);
  }

  await ensureSpaceParentDirectories(bindings.DB, viewerId, targetSpaceId, getParentPath(nextPath));
  await ensureSpaceFileWriteUnlocked(bindings, viewer, targetSpaceId, nextPath);
  await expirePathLocks({
    database: bindings.DB,
    path: nextPath,
    scopeId: targetSpaceId,
    scopeKind: "space",
  });

  if (
    await getPendingFileByPath({
      database: bindings.DB,
      path: nextPath,
      scopeId: targetSpaceId,
      scopeKind: "space",
    })
  ) {
    throw createFileConflictError("A pending upload already exists at the destination path.");
  }

  const existingReady = await getReadyFileByPath({
    database: bindings.DB,
    path: nextPath,
    scopeId: targetSpaceId,
    scopeKind: "space",
  });

  if (existingReady && existingReady.id !== file.id && !(input.overwrite === true)) {
    throw createFileConflictError("A file already exists at the destination path.");
  }

  const destinationObjectKey = `space/${targetSpaceId}/${nextPath}`;
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

  let overwrittenVersion: PendingSpaceFileVersion | null = null;

  if (existingReady && existingReady.id !== file.id) {
    overwrittenVersion = await createPendingSpaceFileVersion(
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
      name: nextPath.split("/").pop() ?? nextPath,
      objectKey: destinationObjectKey,
      parentPath: getParentPath(nextPath),
      path: nextPath,
      scopeId: targetSpaceId,
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

  await commitPendingSpaceFileVersionSafely(bindings, overwrittenVersion, {
    fileId: existingReady?.id,
    nextPath,
    objectKey: existingReady?.object_key,
    previousPath: file.path,
    reason: "move_overwrite",
    scopeId: targetSpaceId,
  });

  logInfo("file.space.updated", {
    fileId: file.id,
    nextPath,
    overwrite: input.overwrite ?? false,
    previousPath: file.path,
    previousScopeId: file.scope_id,
    scopeId: targetSpaceId,
    viewerId,
  });

  return toFileRecord(updated);
}
