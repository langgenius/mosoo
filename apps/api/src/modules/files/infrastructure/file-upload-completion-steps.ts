import type { CompleteFileUploadRequest } from "@mosoo/contracts/file";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  createUploadContentMissingError,
  createUploadIntegrityError,
  createUploadInvalidPartError,
  createUploadInvalidStateError,
} from "./file-errors";
import type { FileUploadContext } from "./file-record-model";
import { markUploadFailed, updateFileUploadStatus } from "./file-record-mutations";

interface CompleteStagingUploadInput {
  bindings: ApiBindings;
  context: FileUploadContext;
  request: CompleteFileUploadRequest;
}

export function ensureUploadCanComplete(context: FileUploadContext): void {
  if (!["pending", "uploading", "completing"].includes(context.upload.status)) {
    throw createUploadInvalidStateError("This upload session can no longer be completed.");
  }
}

export async function completeStagingUpload(input: CompleteStagingUploadInput): Promise<void> {
  const { bindings, context, request } = input;

  if (context.upload.strategy === "multipart") {
    const parts = toCompletedMultipartParts(input);
    if (context.upload.status === "completing") {
      if (await bindings.FILE_BUCKET.head(context.file.object_key)) {
        return;
      }
    } else {
      await markUploadCompleting(bindings.DB, context);
    }

    await bindings.FILE_BUCKET.resumeMultipartUpload(
      context.file.object_key,
      parts.multipartUploadId,
    ).complete(parts.parts);
    return;
  }

  if ((request.parts?.length ?? 0) > 0) {
    throw createUploadInvalidPartError("Single PUT uploads do not accept multipart parts.");
  }

  if (context.upload.status !== "completing") {
    await markUploadCompleting(bindings.DB, context);
  }
}

export async function readVerifiedStagingObject(input: {
  bindings: ApiBindings;
  context: FileUploadContext;
}): Promise<R2Object> {
  const { bindings, context } = input;
  const stagingObject = await bindings.FILE_BUCKET.head(context.file.object_key);

  if (!stagingObject) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadContentMissingError("Uploaded object could not be found in R2.");
  }

  if (stagingObject.size !== context.upload.expected_size) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadIntegrityError("Uploaded object size does not match the expected size.");
  }

  if (
    (stagingObject.httpMetadata?.contentType ?? "application/octet-stream") !==
    context.upload.content_type
  ) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadIntegrityError(
      "Uploaded object content type does not match the declared upload.",
    );
  }

  return stagingObject;
}

function toCompletedMultipartParts(input: CompleteStagingUploadInput): {
  multipartUploadId: string;
  parts: R2UploadedPart[];
} {
  const parts = (input.request.parts ?? [])
    .map((part) => ({
      etag: part.etag,
      partNumber: part.partNumber,
    }))
    .filter(
      (part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag.length > 0,
    );

  const multipartUploadId = input.context.upload.multipart_upload_id;

  if (parts.length === 0 || multipartUploadId === null || multipartUploadId.length === 0) {
    throw createUploadInvalidPartError("Multipart uploads require completed parts.");
  }

  return {
    multipartUploadId,
    parts: parts.toSorted((left, right) => left.partNumber - right.partNumber),
  };
}

async function markUploadCompleting(
  database: D1Database,
  context: FileUploadContext,
): Promise<void> {
  await updateFileUploadStatus(database, {
    status: "completing",
    uploadId: context.upload.id,
  });
}
