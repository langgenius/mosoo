import { RuntimeBucketMountConflictError } from "./runtime-subject-lifecycle/runtime-subject-errors";

function getErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return error.message;
}

function parseMountedBucketReference(errorMessage: string): {
  readonly bucket: string;
  readonly prefix: string;
} | null {
  const bucketMatch = /bucket "([^":]+):(.*?)"/.exec(errorMessage);

  if (!bucketMatch) {
    return null;
  }

  const [, bucket, prefix] = bucketMatch;

  if (bucket === undefined || prefix === undefined) {
    return null;
  }

  return { bucket, prefix };
}

export function toRuntimeBucketMountConflictError(
  error: unknown,
  input: {
    readonly mountPath: string;
  },
): RuntimeBucketMountConflictError | null {
  const message = getErrorMessage(error);

  if (message === null) {
    return null;
  }

  const normalizedMessage = message.toLowerCase();

  if (
    !normalizedMessage.includes("mount path already in use") &&
    !normalizedMessage.includes("already in use")
  ) {
    return null;
  }

  const bucketReference = parseMountedBucketReference(message);

  return new RuntimeBucketMountConflictError({
    bucket: bucketReference?.bucket ?? null,
    cause: error,
    mountPath: input.mountPath,
    prefix: bucketReference?.prefix ?? null,
  });
}
