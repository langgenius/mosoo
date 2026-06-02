import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { FileControlError, toFileStorageMessage } from "./file-errors";
import type {
  CopyObjectInput,
  CopyObjectOptions,
  CopyObjectResult,
  DeleteObjectOptions,
  HeadObjectResult,
  PutObjectInput,
  PutObjectOptions,
} from "./r2-s3-client-types";
import { formatR2EtagHeader, normalizeR2Etag } from "./r2-s3-etag";

function toHeadObjectResult(object: R2Object): HeadObjectResult {
  return {
    contentLength: object.size,
    contentType: object.httpMetadata?.contentType ?? null,
    etag: object.etag,
  };
}

function hasHeaderValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function createPutOnlyIfHeaders(options: PutObjectOptions): Headers {
  const headers = new Headers();

  if (hasHeaderValue(options.ifMatch)) {
    headers.set("If-Match", formatR2EtagHeader(options.ifMatch));
  }

  if (hasHeaderValue(options.ifNoneMatch)) {
    headers.set("If-None-Match", formatR2EtagHeader(options.ifNoneMatch));
  }

  return headers;
}

function isR2ObjectBody(object: R2Object | R2ObjectBody | null): object is R2ObjectBody {
  return object !== null && "body" in object;
}

function createObjectWriteConflict(options: PutObjectOptions): FileControlError {
  const isPreconditionFailure = hasHeaderValue(options.ifMatch);

  return new FileControlError(
    isPreconditionFailure ? 412 : 409,
    isPreconditionFailure ? "file_precondition_failed" : "file_conflict",
    isPreconditionFailure
      ? "File was changed by someone else, please refresh."
      : "Object already exists at this path.",
  );
}

function createCopyWriteConflict(options: CopyObjectOptions | undefined): FileControlError {
  const isPreconditionFailure = hasHeaderValue(options?.destinationIfMatch);

  return new FileControlError(
    isPreconditionFailure ? 412 : 409,
    isPreconditionFailure ? "file_precondition_failed" : "file_conflict",
    isPreconditionFailure
      ? "File was changed by someone else, please refresh."
      : "Destination object precondition failed.",
  );
}

function createMetadataOptions(source: R2ObjectBody): R2PutOptions {
  const options: R2PutOptions = {};

  if (source.httpMetadata !== undefined) {
    options.httpMetadata = source.httpMetadata;
  }

  if (source.customMetadata !== undefined) {
    options.customMetadata = source.customMetadata;
  }

  return options;
}

async function getCopySource(input: CopyObjectInput): Promise<R2ObjectBody> {
  const sourceIfMatch = input.options?.sourceIfMatch;

  try {
    const source = hasHeaderValue(sourceIfMatch)
      ? await input.bindings.FILE_BUCKET.get(input.sourceObjectKey, {
          onlyIf: {
            etagMatches: sourceIfMatch,
          },
        })
      : await input.bindings.FILE_BUCKET.get(input.sourceObjectKey);

    if (source === null) {
      throw new FileControlError(404, "file_not_found", "File was deleted by someone else.");
    }

    if (!isR2ObjectBody(source)) {
      throw new FileControlError(
        412,
        "file_precondition_failed",
        "File was changed by someone else, please refresh.",
      );
    }

    return source;
  } catch (error) {
    if (error instanceof FileControlError) {
      throw error;
    }

    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Source object could not be loaded."),
      true,
    );
  }
}

export async function headObject(
  bindings: ApiBindings,
  objectKey: string,
): Promise<HeadObjectResult | null> {
  try {
    const object = await bindings.FILE_BUCKET.head(objectKey);
    return object === null ? null : toHeadObjectResult(object);
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Object metadata could not be loaded."),
      true,
    );
  }
}

export async function getObjectBody(
  bindings: ApiBindings,
  objectKey: string,
): Promise<R2ObjectBody | null> {
  try {
    const object = await bindings.FILE_BUCKET.get(objectKey);
    return isR2ObjectBody(object) ? object : null;
  } catch (error) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Object content could not be loaded."),
      true,
    );
  }
}

export async function deleteObject(
  bindings: ApiBindings,
  objectKey: string,
  options: DeleteObjectOptions = {},
): Promise<void> {
  if (hasHeaderValue(options.ifMatch)) {
    const object = await headObject(bindings, objectKey);

    if (object === null) {
      throw new FileControlError(404, "file_not_found", "File was deleted by someone else.");
    }

    if (normalizeR2Etag(object.etag) !== normalizeR2Etag(options.ifMatch)) {
      throw new FileControlError(
        412,
        "file_precondition_failed",
        "File was changed by someone else, please refresh.",
      );
    }
  }

  try {
    await bindings.FILE_BUCKET.delete(objectKey);
  } catch (error) {
    throw new FileControlError(
      503,
      "file_delete_failed",
      toFileStorageMessage(error, "Object could not be deleted."),
      true,
    );
  }
}

export async function copyObject(input: CopyObjectInput): Promise<CopyObjectResult> {
  const source = await getCopySource(input);
  const putOptions = createMetadataOptions(source);
  const hasDestinationPrecondition =
    hasHeaderValue(input.options?.destinationIfMatch) ||
    hasHeaderValue(input.options?.destinationIfNoneMatch);

  try {
    if (hasDestinationPrecondition) {
      const copied = await input.bindings.FILE_BUCKET.put(input.destinationObjectKey, source.body, {
        ...putOptions,
        onlyIf: createPutOnlyIfHeaders({
          ifMatch: input.options?.destinationIfMatch,
          ifNoneMatch: input.options?.destinationIfNoneMatch,
        }),
      });

      if (copied === null) {
        throw createCopyWriteConflict(input.options);
      }

      return { etag: copied.etag };
    }

    const copied = await input.bindings.FILE_BUCKET.put(
      input.destinationObjectKey,
      source.body,
      putOptions,
    );

    return { etag: copied.etag };
  } catch (error) {
    if (error instanceof FileControlError) {
      throw error;
    }

    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Destination object could not be written."),
      true,
    );
  }
}

export async function putObject(input: PutObjectInput): Promise<HeadObjectResult> {
  const options = input.options ?? {};
  const putOptions: R2PutOptions = {
    httpMetadata: {
      contentType: input.contentType,
    },
  };
  const hasPrecondition = hasHeaderValue(options.ifMatch) || hasHeaderValue(options.ifNoneMatch);

  try {
    if (hasPrecondition) {
      const object = await input.bindings.FILE_BUCKET.put(input.objectKey, input.body, {
        ...putOptions,
        onlyIf: createPutOnlyIfHeaders(options),
      });

      if (object === null) {
        throw createObjectWriteConflict(options);
      }

      return toHeadObjectResult(object);
    }

    const object = await input.bindings.FILE_BUCKET.put(input.objectKey, input.body, putOptions);
    return toHeadObjectResult(object);
  } catch (error) {
    if (error instanceof FileControlError) {
      throw error;
    }

    throw new FileControlError(
      503,
      "file_storage_unavailable",
      toFileStorageMessage(error, "Object content could not be written."),
      true,
    );
  }
}
