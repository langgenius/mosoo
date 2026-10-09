import type { CompleteFileUploadRequest, FileRecord } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import type { FileId, SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import {
  createApiWideEvent,
  createErrorLogContext,
  emitApiWideEvent,
  logError,
} from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { admitPreviewFileActivity } from "../../sessions/infrastructure/preview-retention.repository";
import { createFinalObjectKey } from "./file-paths";
import { ensureUploadAccess } from "./file-record-access";
import { toFileRecord } from "./file-record-model";
import type { FileRecordRow, FileUploadContext } from "./file-record-model";
import { expireUploadIfNeeded, updateFileUploadStatus } from "./file-record-mutations";
import {
  completeStagingUpload,
  ensureUploadCanComplete,
  readVerifiedStagingObject,
} from "./file-upload-completion-steps";
import { copyR2Object, normalizeR2Etag } from "./r2-object";

function isMatchingRecoveredFinalObject(
  finalObject: R2Object | null,
  stagingObject: R2Object,
): finalObject is R2Object {
  return (
    finalObject !== null &&
    normalizeR2Etag(finalObject.etag) === normalizeR2Etag(stagingObject.etag) &&
    finalObject.size === stagingObject.size &&
    (finalObject.httpMetadata?.contentType ?? "application/octet-stream") ===
      (stagingObject.httpMetadata?.contentType ?? "application/octet-stream")
  );
}

async function finalizeReadyFileRecord(
  bindings: ApiBindings,
  context: FileUploadContext,
  finalObject: R2Object,
  finalObjectKey: string,
): Promise<FileRecord> {
  const timestampMs = currentTimestampMs();

  if (context.file.scope_kind === "session") {
    await admitPreviewFileActivity(bindings.DB, context.file.scope_id as SessionId, timestampMs);
  }

  const finalized: FileRecordRow = {
    ...context.file,
    committed: context.file.scope_kind === "session" || context.file.committed === 1 ? 1 : 0,
    etag: finalObject.etag,
    expires_at:
      context.file.purpose === "agent_package" || context.file.purpose === "app_draft"
        ? context.file.expires_at
        : null,
    mime_type: finalObject.httpMetadata?.contentType ?? null,
    object_key: finalObjectKey,
    size: finalObject.size,
    status: "ready",
    updated_at: timestampMs,
  };

  await getAppDatabase(bindings.DB)
    .update(fileRecordsTable)
    .set({
      committed: finalized.committed === 1,
      etag: finalized.etag,
      expiresAt: finalized.expires_at,
      mimeType: finalized.mime_type,
      objectKey: finalized.object_key,
      size: finalized.size,
      status: finalized.status,
      updatedAt: timestampMs,
    })
    .where(eq(fileRecordsTable.id, context.file.id))
    .run();

  await updateFileUploadStatus(bindings.DB, {
    status: "completed",
    timestampMs,
    uploadId: context.upload.id,
  });

  return toFileRecord(finalized);
}

export async function completeFileUpload(operation: {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}): Promise<FileRecord> {
  const { bindings, fileId, input, viewer } = operation;
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  const { file, upload } = context;
  const uploadEvent = createApiWideEvent("file.upload.complete", {
    fields: {
      file: {
        id: file.id,
        path: file.path,
        scope_id: upload.scope_id,
        scope_kind: upload.scope_kind,
      },
      upload: {
        id: upload.id,
        strategy: upload.strategy,
        viewer_account_id: viewer.id,
      },
    },
  });

  try {
    await expireUploadIfNeeded(bindings.DB, context);
    ensureUploadCanComplete(context);
    await completeStagingUpload({ bindings, context, request: input });

    const stagingObject = await readVerifiedStagingObject({ bindings, context });
    const finalObjectKey = createFinalObjectKey(file);
    let finalObject =
      upload.status === "completing" && file.object_key !== finalObjectKey
        ? await bindings.FILE_BUCKET.head(finalObjectKey)
        : null;

    if (!isMatchingRecoveredFinalObject(finalObject, stagingObject)) {
      finalObject = await copyR2Object(bindings.FILE_BUCKET, file.object_key, finalObjectKey);
    }

    const finalizedFile = await finalizeReadyFileRecord(
      bindings,
      context,
      finalObject,
      finalObjectKey,
    );

    await bindings.FILE_BUCKET.delete(file.object_key).catch((error: unknown) => {
      logError("file.cleanup.failed.staging-object", {
        ...createErrorLogContext(error),
        fileId: file.id,
        objectKey: file.object_key,
        uploadId: upload.id,
      });
    });

    uploadEvent.merge("storage", {
      final_object_key: finalObjectKey,
      size: finalObject.size,
    });
    emitApiWideEvent(uploadEvent, {
      status: "success",
    });

    return finalizedFile;
  } catch (error) {
    uploadEvent.setError(error, {
      fileId: file.id,
      path: file.path,
      scopeId: upload.scope_id,
      scopeKind: upload.scope_kind,
      uploadId: upload.id,
      viewerId: viewer.id,
    });
    emitApiWideEvent(uploadEvent, {
      ...(error instanceof Error ? { error } : {}),
      status: "error",
    });

    throw error;
  }
}
