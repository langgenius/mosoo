import type { CompleteFileUploadRequest } from "@mosoo/contracts/file";
import type { UploadId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  createUploadContentMissingError,
  createUploadIntegrityError,
  createUploadInvalidPartError,
  createUploadInvalidStateError,
} from "./file-errors";
import { markUploadFailed, updateFileUploadStatus } from "./file-record-store";
import type { FileUploadContext } from "./file-record-store";
import { completeMultipartUpload, headObject, normalizeR2Etag } from "./r2-s3-client";
import type {
  CompleteMultipartUploadInput,
  CopyObjectOptions,
  HeadObjectResult,
} from "./r2-s3-client";

interface CompleteStagingUploadInput {
  bindings: ApiBindings;
  context: FileUploadContext;
  request: CompleteFileUploadRequest;
}

interface VerifyStagingObjectInput {
  bindings: ApiBindings;
  context: FileUploadContext;
}

interface FinalizeCopyOptionsInput {
  existingDestinationEtag: string | null | undefined;
  ifMatchEtag: string | null;
  overwrite: boolean;
  sourceEtag: string;
}

export function ensureUploadCanComplete(context: FileUploadContext): void {
  if (!["pending", "uploading", "completing"].includes(context.upload.status)) {
    throw createUploadInvalidStateError("This upload session can no longer be completed.");
  }
}

export async function completeStagingUpload(input: CompleteStagingUploadInput): Promise<void> {
  const { bindings, context, request } = input;

  if (context.upload.strategy === "multipart") {
    const multipartInput = toCompleteMultipartUploadInput(input);
    if (context.upload.status === "completing") {
      const existingStagingObject = await headObject(bindings, context.file.object_key);

      if (existingStagingObject) {
        return;
      }
    } else {
      await markUploadCompleting(bindings.DB, context.upload.id);
    }

    await completeMultipartUpload(multipartInput);
    return;
  }

  if ((request.parts?.length ?? 0) > 0) {
    throw createUploadInvalidPartError("Single PUT uploads do not accept multipart parts.");
  }

  if (context.upload.status !== "completing") {
    await markUploadCompleting(bindings.DB, context.upload.id);
  }
}

export async function readVerifiedStagingObject(
  input: VerifyStagingObjectInput,
): Promise<HeadObjectResult> {
  const { bindings, context } = input;
  const stagingHead = await headObject(bindings, context.file.object_key);

  if (!stagingHead) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadContentMissingError("Uploaded object could not be found in R2.");
  }

  if (stagingHead.contentLength !== context.upload.expected_size) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadIntegrityError("Uploaded object size does not match the expected size.");
  }

  if ((stagingHead.contentType ?? "application/octet-stream") !== context.upload.content_type) {
    await markUploadFailed(bindings.DB, context);
    throw createUploadIntegrityError(
      "Uploaded object content type does not match the declared upload.",
    );
  }

  return stagingHead;
}

export function buildFinalizeCopyOptions(input: FinalizeCopyOptionsInput): CopyObjectOptions {
  const copyOptions: CopyObjectOptions = {
    sourceIfMatch: input.sourceEtag,
  };

  if (input.overwrite) {
    const expectedDestinationEtag =
      normalizeR2Etag(input.ifMatchEtag) ?? normalizeR2Etag(input.existingDestinationEtag);

    if (expectedDestinationEtag !== null && expectedDestinationEtag.length > 0) {
      copyOptions.destinationIfMatch = expectedDestinationEtag;
    }
  } else {
    copyOptions.destinationIfNoneMatch = "*";
  }

  return copyOptions;
}

function toCompleteMultipartUploadInput(
  input: CompleteStagingUploadInput,
): CompleteMultipartUploadInput {
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
    bindings: input.bindings,
    objectKey: input.context.file.object_key,
    parts: parts.toSorted((left, right) => left.partNumber - right.partNumber),
    uploadId: multipartUploadId,
  };
}

async function markUploadCompleting(database: D1Database, uploadId: UploadId): Promise<void> {
  await updateFileUploadStatus(database, {
    status: "completing",
    uploadId,
  });
}
