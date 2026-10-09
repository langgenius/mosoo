import { createFileNotFoundError } from "./file-errors";

export function normalizeR2Etag(etag: string | null | undefined): string | null {
  const normalized =
    etag
      ?.trim()
      .replace(/^W\/\s*/i, "")
      .trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length >= 2) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

export async function copyR2Object(
  bucket: R2Bucket,
  sourceKey: string,
  destinationKey: string,
): Promise<R2Object> {
  const source = await bucket.get(sourceKey);

  if (source === null) {
    throw createFileNotFoundError("File was deleted by someone else.");
  }

  return bucket.put(destinationKey, source.body, { httpMetadata: source.httpMetadata ?? {} });
}
