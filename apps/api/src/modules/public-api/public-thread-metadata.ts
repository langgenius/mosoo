import type { PersonalAccessTokenId } from "@mosoo/id";

const PUBLIC_API_FIELDS = new Set(["created_by", "idempotency_key", "source"]);

export interface PublicApiThreadCreatedByMetadata {
  token_id: PersonalAccessTokenId;
  token_label: string;
}

export interface PublicApiThreadMetadata {
  created_by: PublicApiThreadCreatedByMetadata;
  idempotency_key: string | null;
  source: "public_api";
}

export interface PublicApiThreadRecordMetadata {
  idempotency_key: string | null;
  source: "public_api";
}

interface PublicApiThreadMetadataInput {
  createdBy: PublicApiThreadCreatedByMetadata;
  idempotencyKey: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}

export function createPublicApiThreadMetadata(
  input: PublicApiThreadMetadataInput,
): PublicApiThreadMetadata {
  return {
    created_by: input.createdBy,
    idempotency_key: input.idempotencyKey,
    source: "public_api",
  };
}

/**
 * Reads only the stable envelope needed to identify a stored Public Thread.
 * Creator details are deliberately opaque here: authorization comes from the
 * persisted account and Agent ownership columns, so historical records remain
 * readable without retaining parsers for retired caller kinds.
 */
export function parsePublicApiThreadRecordMetadata(
  raw: string,
): PublicApiThreadRecordMetadata | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const metadata = parsed["public_api"];

  if (
    !isRecord(metadata) ||
    !hasOnlyFields(metadata, PUBLIC_API_FIELDS) ||
    metadata["source"] !== "public_api"
  ) {
    return null;
  }

  const idempotencyKey = metadata["idempotency_key"];

  if (
    !isRecord(metadata["created_by"]) ||
    (idempotencyKey !== null && typeof idempotencyKey !== "string")
  ) {
    return null;
  }

  return {
    idempotency_key: idempotencyKey,
    source: "public_api",
  };
}
