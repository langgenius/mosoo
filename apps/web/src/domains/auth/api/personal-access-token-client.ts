import type {
  CreateOrganizationServiceTokenResponse,
  CreatePersonalAccessTokenResponse,
  OrganizationServiceTokenListResponse,
  OrganizationServiceTokenSummary,
  PersonalAccessTokenListResponse,
  PersonalAccessTokenSummary,
} from "@mosoo/contracts/auth";
import type {
  AccountId,
  AgentId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
} from "@mosoo/contracts/id";

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

function toAccountId(id: string): AccountId {
  return id as AccountId;
}

function toAgentId(id: string): AgentId {
  return id as AgentId;
}

function toOrganizationId(id: string): OrganizationId {
  return id as OrganizationId;
}

function toOrganizationServiceTokenId(id: string): OrganizationServiceTokenId {
  return id as OrganizationServiceTokenId;
}

function toPersonalAccessTokenId(id: string): PersonalAccessTokenId {
  return id as PersonalAccessTokenId;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function parsePersonalAccessTokenSummary(value: unknown): PersonalAccessTokenSummary {
  if (!isJsonObject(value)) {
    throw new Error("Invalid personal access token response.");
  }

  const { createdAt, id, label, lastUsedAt, revokedAt } = value;

  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof label !== "string" ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string") ||
    (revokedAt !== null && typeof revokedAt !== "string")
  ) {
    throw new Error("Invalid personal access token response.");
  }

  return {
    createdAt,
    id: toPersonalAccessTokenId(id),
    label,
    lastUsedAt,
    revokedAt,
  };
}

function parseOrganizationServiceTokenSummary(value: unknown): OrganizationServiceTokenSummary {
  if (!isJsonObject(value)) {
    throw new Error("Invalid organization service token response.");
  }

  const {
    allowAttribution,
    allowedAgentIds,
    createdAt,
    createdByAccountId,
    id,
    label,
    lastUsedAt,
    organizationId,
    revokedAt,
  } = value;

  if (
    typeof allowAttribution !== "boolean" ||
    !Array.isArray(allowedAgentIds) ||
    allowedAgentIds.some((agentId) => typeof agentId !== "string") ||
    typeof createdAt !== "string" ||
    typeof createdByAccountId !== "string" ||
    typeof id !== "string" ||
    typeof label !== "string" ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string") ||
    typeof organizationId !== "string" ||
    (revokedAt !== null && typeof revokedAt !== "string")
  ) {
    throw new Error("Invalid organization service token response.");
  }

  return {
    allowAttribution,
    allowedAgentIds: allowedAgentIds.map(toAgentId),
    createdAt,
    createdByAccountId: toAccountId(createdByAccountId),
    id: toOrganizationServiceTokenId(id),
    label,
    lastUsedAt,
    organizationId: toOrganizationId(organizationId),
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
    throw new Error("Invalid personal access token list response.");
  }

  return {
    tokens: value["tokens"].map((token) => parsePersonalAccessTokenSummary(token)),
  };
}

function parseOrganizationServiceTokenListResponse(
  value: unknown,
): OrganizationServiceTokenListResponse {
  if (!isJsonObject(value) || !Array.isArray(value["tokens"])) {
    throw new Error("Invalid organization service token list response.");
  }

  return {
    tokens: value["tokens"].map((token) => parseOrganizationServiceTokenSummary(token)),
  };
}

function parseCreatePersonalAccessTokenResponse(value: unknown): CreatePersonalAccessTokenResponse {
  if (!isJsonObject(value) || typeof value["value"] !== "string") {
    throw new Error("Invalid personal access token create response.");
  }

  return {
    token: parsePersonalAccessTokenSummary(value["token"]),
    value: value["value"],
  };
}

function parseCreateOrganizationServiceTokenResponse(
  value: unknown,
): CreateOrganizationServiceTokenResponse {
  if (!isJsonObject(value) || typeof value["value"] !== "string") {
    throw new Error("Invalid organization service token create response.");
  }

  return {
    token: parseOrganizationServiceTokenSummary(value["token"]),
    value: value["value"],
  };
}

function parsePersonalAccessTokenDeleteResponse(value: unknown): PersonalAccessTokenDeleteResponse {
  if (!isJsonObject(value) || value["ok"] !== true) {
    throw new Error("Invalid personal access token delete response.");
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

export async function listOrganizationServiceTokens(
  organizationId: OrganizationId,
): Promise<OrganizationServiceTokenListResponse> {
  const params = new URLSearchParams({ organizationId });
  const response = await apiFetch(`/organization-service-tokens?${params.toString()}`, {
    credentials: "include",
  });

  return readJsonResponse(response, parseOrganizationServiceTokenListResponse);
}

export async function createOrganizationServiceToken(input: {
  allowAttribution: boolean;
  allowedAgentIds: AgentId[];
  label: string;
  organizationId: OrganizationId;
}): Promise<CreateOrganizationServiceTokenResponse> {
  const response = await apiFetch("/organization-service-tokens", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readJsonResponse(response, parseCreateOrganizationServiceTokenResponse);
}

export async function revokeOrganizationServiceToken(
  tokenId: OrganizationServiceTokenId,
): Promise<PersonalAccessTokenDeleteResponse> {
  const response = await apiFetch(`/organization-service-tokens/${tokenId}`, {
    credentials: "include",
    method: "DELETE",
  });

  return readJsonResponse(response, parsePersonalAccessTokenDeleteResponse);
}
