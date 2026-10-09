import type { UploadFilePartResponse } from "@mosoo/contracts/file";
import { ignorePromiseRejection } from "@mosoo/effects";
import type { FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createUploadContentMissingError,
  createUploadInvalidPartError,
  createUploadInvalidStateError,
} from "./file-errors";
import { ensureUploadAccess } from "./file-record-access";
import {
  expireUploadIfNeeded,
  updateFileRecordStatus,
  updateFileUploadStatus,
} from "./file-record-mutations";

export async function uploadFileContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  const { upload } = context;
  await expireUploadIfNeeded(bindings.DB, context);

  if (upload.strategy !== "single_put") {
    throw createUploadInvalidStateError("This upload requires multipart part uploads.");
  }

  if (!["pending", "uploading"].includes(upload.status)) {
    throw createUploadInvalidStateError("This upload session can no longer accept content.");
  }

  if (!body) {
    throw createUploadContentMissingError("Upload content is required.");
  }

  await bindings.FILE_BUCKET.put(context.file.object_key, body, {
    httpMetadata: {
      contentType: upload.content_type,
    },
  });

  await updateFileUploadStatus(bindings.DB, {
    status: "uploading",
    uploadId: upload.id,
  });
}

export async function uploadFilePart(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  partNumber: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<UploadFilePartResponse> {
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  const { upload } = context;
  await expireUploadIfNeeded(bindings.DB, context);

  if (upload.strategy !== "multipart" || !isTruthy(upload.multipart_upload_id)) {
    throw createUploadInvalidStateError("This upload does not use multipart transfer.");
  }

  if (!["pending", "uploading"].includes(upload.status)) {
    throw createUploadInvalidStateError("This upload session can no longer accept parts.");
  }

  if (!Number.isInteger(partNumber) || partNumber <= 0) {
    throw createUploadInvalidPartError("Part number must be a positive integer.");
  }

  if (!body) {
    throw createUploadContentMissingError("Upload part content is required.");
  }

  const uploadedPart = await bindings.FILE_BUCKET.resumeMultipartUpload(
    context.file.object_key,
    upload.multipart_upload_id,
  ).uploadPart(partNumber, body);

  await updateFileUploadStatus(bindings.DB, {
    status: "uploading",
    uploadId: upload.id,
  });

  return uploadedPart;
}

export async function abortFileUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
): Promise<void> {
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  await expireUploadIfNeeded(bindings.DB, context);
  const timestampMs = currentTimestampMs();

  if (!["pending", "uploading"].includes(context.upload.status)) {
    throw createUploadInvalidStateError("This upload session can no longer be aborted.");
  }

  const multipartUploadId = context.upload.multipart_upload_id;
  if (context.upload.strategy === "multipart" && multipartUploadId !== null) {
    await bindings.FILE_BUCKET.resumeMultipartUpload(
      context.file.object_key,
      multipartUploadId,
    ).abort();
  }

  await bindings.FILE_BUCKET.delete(context.file.object_key).catch(ignorePromiseRejection);

  await updateFileUploadStatus(bindings.DB, {
    status: "aborted",
    timestampMs,
    uploadId: context.upload.id,
  });
  await updateFileRecordStatus(bindings.DB, {
    fileId: context.file.id,
    status: "failed",
    timestampMs,
  });
}
