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
import {
  ensureUploadAccess,
  expireUploadIfNeeded,
  updateFileRecordStatus,
  updateFileUploadStatus,
} from "./file-record-store";
import { abortMultipartUpload, deleteObject, putObject, uploadMultipartPart } from "./r2-s3-client";
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

  await putObject({
    bindings,
    body,
    contentType: upload.content_type,
    objectKey: context.file.object_key,
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

  const uploadedPart = await uploadMultipartPart({
    bindings,
    body,
    objectKey: context.file.object_key,
    partNumber,
    uploadId: upload.multipart_upload_id,
  });

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
    await abortMultipartUpload(bindings, context.file.object_key, multipartUploadId);
  }

  await deleteObject(bindings, context.file.object_key).catch(ignorePromiseRejection);

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
