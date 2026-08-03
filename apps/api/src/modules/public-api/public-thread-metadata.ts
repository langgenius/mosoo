import { parsePlatformId } from "@mosoo/id";
import type { AccountId, PersonalAccessTokenId, PlatformId } from "@mosoo/id";

const PUBLIC_API_THREAD_CREATED_BY_KIND = "access_token";
const LEGACY_PUBLIC_API_THREAD_CREATED_BY_KIND = "human_pat";

export interface PublicApiThreadCreatedByMetadata {
  account_id: AccountId;
  id: AccountId;
  kind: typeof PUBLIC_API_THREAD_CREATED_BY_KIND;
  token_id: PersonalAccessTokenId;
  token_label: string;
}

export interface PublicApiThreadMetadata {
  created_by: PublicApiThreadCreatedByMetadata;
  idempotency_key: string | null;
  source: "public_api";
  user_id: string | null;
}

interface PublicApiThreadMetadataInput {
  admission: {
    createdById: PlatformId;
    tokenId: PersonalAccessTokenId;
    tokenLabel: string;
  };
  idempotencyKey: string | null;
  userId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCreatedByMetadata(value: unknown): PublicApiThreadCreatedByMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const kind = value["kind"];
  const accountId = value["account_id"];
  const tokenId = value["token_id"];
  const tokenLabel = value["token_label"];

  if (
    typeof id !== "string" ||
    (kind !== PUBLIC_API_THREAD_CREATED_BY_KIND &&
      kind !== LEGACY_PUBLIC_API_THREAD_CREATED_BY_KIND) ||
    typeof tokenId !== "string" ||
    typeof tokenLabel !== "string"
  ) {
    return null;
  }

  try {
    const parsedAccountId = parsePlatformId<AccountId>(
      typeof accountId === "string" ? accountId : id,
      "Public API thread creator account ID",
    );

    return {
      account_id: parsedAccountId,
      id: parsedAccountId,
      kind: PUBLIC_API_THREAD_CREATED_BY_KIND,
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
  const createdById = parsePlatformId<AccountId>(
    input.admission.createdById,
    "Public API thread creator account ID",
  );

  return {
    created_by: {
      account_id: createdById,
      id: createdById,
      kind: PUBLIC_API_THREAD_CREATED_BY_KIND,
      token_id: parsePlatformId<PersonalAccessTokenId>(
        input.admission.tokenId,
        "Public API token ID",
      ),
      token_label: input.admission.tokenLabel,
    },
    idempotency_key: input.idempotencyKey,
    source: "public_api",
    user_id: input.userId,
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

  if (!isRecord(metadata) || metadata["source"] !== "public_api") {
    return null;
  }

  const createdBy = readCreatedByMetadata(metadata["created_by"]);
  const idempotencyKey = metadata["idempotency_key"] ?? null;
  const userId = metadata["user_id"] ?? metadata["external_user_id"] ?? null;

  if (
    (idempotencyKey !== null && typeof idempotencyKey !== "string") ||
    (userId !== null && typeof userId !== "string") ||
    createdBy === null
  ) {
    return null;
  }

  return {
    created_by: createdBy,
    idempotency_key: idempotencyKey,
    source: "public_api",
    user_id: userId,
  };
}
