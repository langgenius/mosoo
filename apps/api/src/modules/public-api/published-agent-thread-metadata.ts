import { parseNullablePlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
  PlatformId,
} from "@mosoo/id";

export type PublicApiThreadCreatedByMetadata =
  | {
      account_id: AccountId;
      id: AccountId;
      kind: "human_pat";
      token_id: PersonalAccessTokenId;
      token_label: string;
    }
  | {
      id: OrganizationServiceTokenId;
      kind: "service_token";
      service_token_id: OrganizationServiceTokenId;
      token_id: OrganizationServiceTokenId;
      token_label: string;
    };

export interface PublicApiThreadMetadata {
  attributed_user_id: AccountId | null;
  client_external_ref: string | null;
  created_by: PublicApiThreadCreatedByMetadata;
  source: "public_api";
}

interface PublicApiThreadMetadataInput {
  admission: {
    attributedUserId: AccountId | null;
    createdById: PlatformId;
    createdByKind: PublicApiThreadCreatedByMetadata["kind"];
    tokenId: OrganizationServiceTokenId | PersonalAccessTokenId;
    tokenLabel: string;
  };
  clientExternalRef: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : undefined;
}

function readCreatedByMetadata(value: unknown): PublicApiThreadCreatedByMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];
  const kind = value["kind"];
  const accountId = value["account_id"];
  const serviceTokenId = value["service_token_id"];
  const tokenId = value["token_id"];
  const tokenLabel = value["token_label"];

  if (
    typeof id !== "string" ||
    (kind !== "human_pat" && kind !== "service_token") ||
    typeof tokenId !== "string" ||
    typeof tokenLabel !== "string"
  ) {
    return null;
  }

  try {
    if (kind === "human_pat") {
      const parsedAccountId = parsePlatformId<AccountId>(
        typeof accountId === "string" ? accountId : id,
        "Public API thread creator account ID",
      );

      return {
        account_id: parsedAccountId,
        id: parsedAccountId,
        kind,
        token_id: parsePlatformId<PersonalAccessTokenId>(tokenId, "Public API PAT ID"),
        token_label: tokenLabel,
      };
    }

    const parsedServiceTokenId = parsePlatformId<OrganizationServiceTokenId>(
      typeof serviceTokenId === "string" ? serviceTokenId : tokenId,
      "Public API service token ID",
    );

    return {
      id: parsedServiceTokenId,
      kind,
      service_token_id: parsedServiceTokenId,
      token_id: parsedServiceTokenId,
      token_label: tokenLabel,
    };
  } catch {
    return null;
  }
}

export function createPublicApiThreadMetadata(
  input: PublicApiThreadMetadataInput,
): PublicApiThreadMetadata {
  const createdBy: PublicApiThreadCreatedByMetadata =
    input.admission.createdByKind === "human_pat"
      ? {
          account_id: parsePlatformId<AccountId>(
            input.admission.createdById,
            "Public API thread creator account ID",
          ),
          id: parsePlatformId<AccountId>(
            input.admission.createdById,
            "Public API thread creator account ID",
          ),
          kind: "human_pat",
          token_id: parsePlatformId<PersonalAccessTokenId>(
            input.admission.tokenId,
            "Public API PAT ID",
          ),
          token_label: input.admission.tokenLabel,
        }
      : {
          id: parsePlatformId<OrganizationServiceTokenId>(
            input.admission.tokenId,
            "Public API service token ID",
          ),
          kind: "service_token",
          service_token_id: parsePlatformId<OrganizationServiceTokenId>(
            input.admission.tokenId,
            "Public API service token ID",
          ),
          token_id: parsePlatformId<OrganizationServiceTokenId>(
            input.admission.tokenId,
            "Public API service token ID",
          ),
          token_label: input.admission.tokenLabel,
        };

  return {
    attributed_user_id: parseNullablePlatformId(
      input.admission.attributedUserId,
      "Attributed user ID",
    ) as AccountId | null,
    client_external_ref: input.clientExternalRef,
    created_by: createdBy,
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

  if (!isRecord(metadata) || metadata["source"] !== "public_api") {
    return null;
  }

  const attributedUserId = readNullableString(metadata["attributed_user_id"]);
  const clientExternalRef = readNullableString(metadata["client_external_ref"]);
  const createdBy = readCreatedByMetadata(metadata["created_by"]);

  if (attributedUserId === undefined || clientExternalRef === undefined || createdBy === null) {
    return null;
  }

  try {
    return {
      attributed_user_id: parseNullablePlatformId(
        attributedUserId,
        "Attributed user ID",
      ) as AccountId | null,
      client_external_ref: clientExternalRef,
      created_by: createdBy,
      source: "public_api",
    };
  } catch {
    return null;
  }
}
