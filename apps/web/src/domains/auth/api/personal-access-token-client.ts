import type {
  CreatePersonalAccessTokenResponse,
  PersonalAccessTokenListResponse,
  PersonalAccessTokenSummary,
} from "@mosoo/contracts/auth";
import type { PersonalAccessTokenId } from "@mosoo/contracts/id";

import { apiFetch } from "@/platform/http/public-api";

interface PersonalAccessTokenDeleteResponse {
  ok: true;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string | null {
  if (!isJsonObject(value) || typeof value["error"] !== "string") {
    return null;
  }

  return value["error"];
}

function toPersonalAccessTokenId(id: string): PersonalAccessTokenId {
  return id as PersonalAccessTokenId;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function parsePersonalAccessTokenSummary(value: unknown): PersonalAccessTokenSummary {
  if (!isJsonObject(value)) {
    throw new Error("Invalid access token response.");
  }

  const { createdAt, id, label, lastUsedAt, revokedAt } = value;

  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof label !== "string" ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string") ||
    (revokedAt !== null && typeof revokedAt !== "string")
  ) {
    throw new Error("Invalid access token response.");
  }

  return {
    createdAt,
    id: toPersonalAccessTokenId(id),
    label,
    lastUsedAt,
    revokedAt,
  };
}

async function readJsonResponse<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  if (!response.ok) {
    const payload = await readJson(response).catch(() => null);
    throw new Error(readErrorMessage(payload) ?? `${response.status} ${response.statusText}`);
  }

  return parse(await readJson(response));
}

function parsePersonalAccessTokenListResponse(value: unknown): PersonalAccessTokenListResponse {
  if (!isJsonObject(value) || !Array.isArray(value["tokens"])) {
    throw new Error("Invalid access token list response.");
  }

  return {
    tokens: value["tokens"].map((token) => parsePersonalAccessTokenSummary(token)),
  };
}

function parseCreatePersonalAccessTokenResponse(value: unknown): CreatePersonalAccessTokenResponse {
  if (!isJsonObject(value) || typeof value["value"] !== "string") {
    throw new Error("Invalid access token create response.");
  }

  return {
    token: parsePersonalAccessTokenSummary(value["token"]),
    value: value["value"],
  };
}

function parsePersonalAccessTokenDeleteResponse(value: unknown): PersonalAccessTokenDeleteResponse {
  if (!isJsonObject(value) || value["ok"] !== true) {
    throw new Error("Invalid access token delete response.");
  }

  return { ok: true };
}

export async function listPersonalAccessTokens(): Promise<PersonalAccessTokenListResponse> {
  const response = await apiFetch("/access-tokens", {
    credentials: "include",
  });

  return readJsonResponse(response, parsePersonalAccessTokenListResponse);
}

export async function createPersonalAccessToken(
  label: string,
): Promise<CreatePersonalAccessTokenResponse> {
  const response = await apiFetch("/access-tokens", {
    body: JSON.stringify({ label }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJsonResponse(response, parseCreatePersonalAccessTokenResponse);
}

export async function revokePersonalAccessToken(
  tokenId: PersonalAccessTokenId,
): Promise<PersonalAccessTokenDeleteResponse> {
  const response = await apiFetch(`/access-tokens/${tokenId}`, {
    credentials: "include",
    method: "DELETE",
  });

  return readJsonResponse(response, parsePersonalAccessTokenDeleteResponse);
}
