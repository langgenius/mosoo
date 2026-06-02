import type { UploadFilePartResponse } from "@mosoo/contracts/file";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { FileControlError, toFileStorageMessage } from "./file-errors";
import type {
  CompleteMultipartUploadInput,
  CreateMultipartUploadResult,
  UploadMultipartPartInput,
} from "./r2-s3-client-types";

export async function createMultipartUpload(
  bindings: ApiBindings,
  objectKey: string,
  contentType: string,
): Promise<CreateMultipartUploadResult> {
  try {
    const upload = await bindings.FILE_BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: {
        contentType,
      },
    });

    return {
      uploadId: upload.uploadId,
    };
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Multipart upload could not be created."),
      true,
    );
  }
}

export async function uploadMultipartPart(
  input: UploadMultipartPartInput,
): Promise<UploadFilePartResponse> {
  try {
    const upload = input.bindings.FILE_BUCKET.resumeMultipartUpload(
      input.objectKey,
      input.uploadId,
    );
    const uploadedPart = await upload.uploadPart(input.partNumber, input.body);

    return {
      etag: uploadedPart.etag,
      partNumber: uploadedPart.partNumber,
    };
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, `Multipart upload part ${input.partNumber} failed.`),
      true,
    );
  }
}

export async function completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void> {
  try {
    const upload = input.bindings.FILE_BUCKET.resumeMultipartUpload(
      input.objectKey,
      input.uploadId,
    );
    await upload.complete(input.parts);
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Multipart upload could not be completed."),
      true,
    );
  }
}

export async function abortMultipartUpload(
  bindings: ApiBindings,
  objectKey: string,
  uploadId: string,
): Promise<void> {
  try {
    const upload = bindings.FILE_BUCKET.resumeMultipartUpload(objectKey, uploadId);
    await upload.abort();
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Multipart upload could not be aborted."),
      true,
    );
  }
}
