import type { CompleteFileUploadRequest, FileRecord } from "@mosoo/contracts/file";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId } from "@mosoo/id";

import {
  createApiWideEvent,
  createErrorLogContext,
  emitApiWideEvent,
  logError,
  logInfo,
  logWarn,
} from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { FileControlError, createFileConflictError } from "./file-errors";
import { createFinalObjectKey } from "./file-paths";
import { ensureUploadAccess, expireUploadIfNeeded, getReadyFileByPath } from "./file-record-store";
import { getFileScopeDescriptor } from "./file-scope-descriptor";
import {
  buildFinalizeCopyOptions,
  completeStagingUpload,
  ensureUploadCanComplete,
  readVerifiedStagingObject,
} from "./file-upload-completion-steps";
import { finalizeReadyFileRecord } from "./file-upload-finalize";
import {
  commitPendingFileVersionSafely,
  createPendingFileVersion,
  findPendingFileVersion,
} from "./file-version-store";
import type { PendingFileVersion } from "./file-version-store";
import { copyObject, deleteObject, headObject, normalizeR2Etag } from "./r2-s3-client";
import type { HeadObjectResult } from "./r2-s3-client";

function isMatchingRecoveredFinalObject(
  finalHead: HeadObjectResult | null,
  stagingHead: HeadObjectResult,
): finalHead is HeadObjectResult {
  return (
    finalHead !== null &&
    normalizeR2Etag(finalHead.etag) === normalizeR2Etag(stagingHead.etag) &&
    finalHead.contentLength === stagingHead.contentLength &&
    (finalHead.contentType ?? "application/octet-stream") ===
      (stagingHead.contentType ?? "application/octet-stream")
  );
}

export interface CompleteFileUploadOperation {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}

export interface CompleteFileUploadResult {
  file: FileRecord;
}

export async function completeFileUpload(
  operation: CompleteFileUploadOperation,
): Promise<CompleteFileUploadResult> {
  const { bindings, fileId, input, viewer } = operation;
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  const { file, upload } = context;
  const uploadId = upload.id;
  const uploadEvent = createApiWideEvent("file.upload.complete", {
    fields: {
      file: {
        id: file.id,
        path: file.path,
        scope_id: upload.scope_id,
        scope_kind: upload.scope_kind,
      },
      upload: {
        id: uploadId,
        overwrite: upload.overwrite === 1,
        strategy: upload.strategy,
        viewer_account_id: viewerId,
      },
    },
  });

  try {
    await expireUploadIfNeeded(bindings.DB, context);
    ensureUploadCanComplete(context);

    const readyConflict = await getReadyFileByPath({
      database: bindings.DB,
      path: file.path,
      scopeId: upload.scope_id,
      scopeKind: upload.scope_kind,
    });

    if (readyConflict && readyConflict.id !== file.id && upload.overwrite !== 1) {
      throw createFileConflictError("A file already exists at this path.");
    }

    await completeStagingUpload({ bindings, context, request: input });

    const stagingHead = await readVerifiedStagingObject({ bindings, context });
    const finalObjectKey = createFinalObjectKey(file);
    const finalizeCopyOptions = buildFinalizeCopyOptions({
      existingDestinationEtag: readyConflict?.etag,
      ifMatchEtag: upload.if_match_etag,
      overwrite: upload.overwrite === 1,
      sourceEtag: stagingHead.etag,
    });

    let overwrittenVersion: PendingFileVersion | null = null;

    if (
      readyConflict &&
      readyConflict.id !== file.id &&
      getFileScopeDescriptor(upload.scope_kind).capabilities.versioning
    ) {
      overwrittenVersion =
        (await findPendingFileVersion(bindings.DB, {
          fileId: readyConflict.id,
          path: file.path,
          reason: "overwrite",
          sourceObjectKey: readyConflict.object_key,
          version: readyConflict.version,
        })) ?? (await createPendingFileVersion(bindings, readyConflict, viewerId, "overwrite"));
    }

    let finalHead: HeadObjectResult | null =
      upload.status === "completing" && file.object_key !== finalObjectKey
        ? await headObject(bindings, finalObjectKey)
        : null;

    if (!isMatchingRecoveredFinalObject(finalHead, stagingHead)) {
      await copyObject({
        bindings,
        destinationObjectKey: finalObjectKey,
        options: finalizeCopyOptions,
        sourceObjectKey: file.object_key,
      });

      finalHead = await headObject(bindings, finalObjectKey);
    }

    if (!finalHead) {
      throw new FileControlError(
        503,
        "file_storage_unavailable",
        "Finalized object could not be read from R2.",
        true,
      );
    }

    const finalizedFile = await finalizeReadyFileRecord({
      bindings,
      context,
      finalHead,
      finalObjectKey,
    });
    await commitPendingFileVersionSafely(bindings, overwrittenVersion, {
      fileId: readyConflict?.id,
      objectKey: readyConflict?.object_key,
      path: file.path,
      reason: "overwrite",
      scopeId: upload.scope_id,
      uploadId,
    });

    if (readyConflict && readyConflict.id !== file.id) {
      await deleteObject(bindings, readyConflict.object_key, {
        ifMatch: readyConflict.etag ?? undefined,
      }).catch((error: unknown) => {
        logError("file.cleanup.failed.old-ready-object", {
          ...createErrorLogContext(error),
          fileId: readyConflict.id,
          objectKey: readyConflict.object_key,
          uploadId,
        });
      });
    }

    await deleteObject(bindings, file.object_key, {
      ifMatch: stagingHead.etag,
    }).catch((error: unknown) => {
      logError("file.cleanup.failed.staging-object", {
        ...createErrorLogContext(error),
        fileId: file.id,
        objectKey: file.object_key,
        uploadId,
      });
    });

    logInfo("file.upload.completed", {
      fileId: file.id,
      finalObjectKey,
      overwrite: upload.overwrite === 1,
      path: file.path,
      scopeId: upload.scope_id,
      scopeKind: upload.scope_kind,
      uploadId,
      viewerId,
    });

    uploadEvent.merge("storage", {
      final_object_key: finalObjectKey,
      size: finalHead.contentLength,
    });
    emitApiWideEvent(uploadEvent, {
      status: "success",
    });

    return {
      file: finalizedFile,
    };
  } catch (error) {
    const logContext = {
      fileId: file.id,
      path: file.path,
      scopeId: upload.scope_id,
      scopeKind: upload.scope_kind,
      uploadId,
      viewerId,
    };

    if (error instanceof FileControlError) {
      if (error.status >= 500) {
        logError("file.upload.failed", {
          ...createErrorLogContext(error),
          ...logContext,
          errorCode: error.code,
          retryable: error.retryable,
          status: error.status,
        });
      } else {
        logWarn("file.upload.rejected", {
          ...logContext,
          errorCode: error.code,
          errorMessage: error.message,
          retryable: error.retryable,
          status: error.status,
        });
      }
    } else {
      logError("file.upload.failed", {
        ...createErrorLogContext(error),
        ...logContext,
      });
    }

    uploadEvent.setError(error, logContext);
    emitApiWideEvent(uploadEvent, {
      ...(error instanceof Error ? { error } : {}),
      status: "error",
    });

    throw error;
  }
}
