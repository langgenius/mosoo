import { mcpServersTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { OAuthMetadata, OAuthTokenResponse, ServerRow } from "./mcp-types";
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonBoundary(raw: string, invalidMessage: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(invalidMessage);
  }
}

function parseOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
  invalidMessage: string,
): string | undefined {
  const value = record[fieldName];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(invalidMessage);
  }

  return value;
}

function parseOptionalStringArray(
  record: Record<string, unknown>,
  fieldName: string,
  invalidMessage: string,
): string[] | undefined {
  const value = record[fieldName];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(invalidMessage);
  }

  return value;
}

function parseOAuthMetadata(value: unknown, invalidMessage: string): OAuthMetadata {
  if (!isRecord(value)) {
    throw new Error(invalidMessage);
  }

  const authorizationEndpoint = value["authorization_endpoint"];
  const tokenEndpoint = value["token_endpoint"];

  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string") {
    throw new TypeError(invalidMessage);
  }

  const registrationEndpoint = parseOptionalString(value, "registration_endpoint", invalidMessage);
  const scopesSupported = parseOptionalStringArray(value, "scopes_supported", invalidMessage);

  return {
    authorization_endpoint: authorizationEndpoint,
    ...(isTruthy(registrationEndpoint) ? { registration_endpoint: registrationEndpoint } : {}),
    ...(scopesSupported ? { scopes_supported: scopesSupported } : {}),
    token_endpoint: tokenEndpoint,
  };
}

function parseOAuthTokenResponse(value: unknown): OAuthTokenResponse {
  const invalidMessage = "OAuth token exchange did not return a valid access_token.";

  if (!isRecord(value) || typeof value["access_token"] !== "string" || !value["access_token"]) {
    throw new Error(invalidMessage);
  }

  const expiresIn = value["expires_in"];
  const refreshToken = value["refresh_token"];
  const { scope } = value;
  const tokenType = value["token_type"];

  if (
    (expiresIn !== undefined && typeof expiresIn !== "number") ||
    (refreshToken !== undefined && typeof refreshToken !== "string") ||
    (scope !== undefined && typeof scope !== "string") ||
    (tokenType !== undefined && typeof tokenType !== "string")
  ) {
    throw new Error(invalidMessage);
  }

  return {
    access_token: value["access_token"],
    ...(typeof expiresIn === "number" ? { expires_in: expiresIn } : {}),
    ...(typeof refreshToken === "string" ? { refresh_token: refreshToken } : {}),
    ...(typeof scope === "string" ? { scope } : {}),
    ...(typeof tokenType === "string" ? { token_type: tokenType } : {}),
  };
}

export async function getOrDiscoverOAuthMetadata(
  database: D1Database,
  server: ServerRow,
): Promise<OAuthMetadata> {
  if (isTruthy(server.oauthMetadataJson)) {
    return parseOAuthMetadata(
      parseJsonBoundary(server.oauthMetadataJson, "Cached OAuth metadata is invalid."),
      "Cached OAuth metadata is invalid.",
    );
  }

  const serverUrl = new URL(server.url);
  const candidates = [
    new URL("/.well-known/oauth-authorization-server", serverUrl.origin).toString(),
    new URL("/.well-known/openid-configuration", serverUrl.origin).toString(),
  ];
  let metadata: OAuthMetadata | null = null;

  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      continue;
    }

    metadata = parseOAuthMetadata(await response.json(), "OAuth discovery metadata is invalid.");
    break;
  }

  if (!metadata) {
    throw new Error("OAuth discovery failed for this MCP server.");
  }

  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({
      oauthMetadataJson: JSON.stringify(metadata),
      updatedAt: currentTimestampMs(),
    })
    .where(eq(mcpServersTable.id, server.id))
    .run();

  return metadata;
}

export async function exchangeOAuthToken(input: {
  clientId: string;
  clientSecret?: string | null;
  code?: string;
  codeVerifier?: string;
  redirectUri: string;
  refreshToken?: string;
  tokenEndpoint: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams();
  body.set("client_id", input.clientId);

  if (isTruthy(input.clientSecret)) {
    body.set("client_secret", input.clientSecret);
  }

  if (isTruthy(input.refreshToken)) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", input.refreshToken);
  } else {
    body.set("code", input.code ?? "");
    body.set("code_verifier", input.codeVerifier ?? "");
    body.set("grant_type", "authorization_code");
    body.set("redirect_uri", input.redirectUri);
  }

  const response = await fetch(input.tokenEndpoint, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("OAuth token exchange failed.");
  }

  return parseOAuthTokenResponse(await response.json());
}
