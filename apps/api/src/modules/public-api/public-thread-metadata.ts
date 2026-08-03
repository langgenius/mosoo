import { parsePlatformId } from "@mosoo/id";
import type { PersonalAccessTokenId } from "@mosoo/id";

const CREATED_BY_FIELDS = new Set(["token_id", "token_label"]);
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

interface PublicApiThreadMetadataInput {
  admission: {
    tokenId: PersonalAccessTokenId;
    tokenLabel: string;
  };
  idempotencyKey: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}

function readCreatedByMetadata(value: unknown): PublicApiThreadCreatedByMetadata | null {
  if (!isRecord(value) || !hasOnlyFields(value, CREATED_BY_FIELDS)) {
    return null;
  }

  const tokenId = value["token_id"];
  const tokenLabel = value["token_label"];

  if (typeof tokenId !== "string" || typeof tokenLabel !== "string") {
    return null;
  }

  try {
    return {
      token_id: parsePlatformId<PersonalAccessTokenId>(tokenId, "Public API token ID"),
      token_label: tokenLabel,
    };
  } catch {
    return null;
  }
}

export function createPublicApiThreadMetadata(
  input: PublicApiThreadMetadataInput,
): PublicApiThreadMetadata {
  return {
    created_by: {
      token_id: parsePlatformId<PersonalAccessTokenId>(
        input.admission.tokenId,
        "Public API token ID",
      ),
      token_label: input.admission.tokenLabel,
    },
    idempotency_key: input.idempotencyKey,
    source: "public_api",
  };
}

export function parsePublicApiThreadMetadata(raw: string): PublicApiThreadMetadata | null {
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

  const createdBy = readCreatedByMetadata(metadata["created_by"]);
  const idempotencyKey = metadata["idempotency_key"];

  if ((idempotencyKey !== null && typeof idempotencyKey !== "string") || createdBy === null) {
    return null;
  }

  return {
    created_by: createdBy,
    idempotency_key: idempotencyKey,
    source: "public_api",
  };
}
