import { toArrayBuffer, toBase64Url } from "../../../shared/bytes";
import { isTruthy } from "../../../shared/truthiness";
import type { OAuthMetadata } from "./mcp-types";

interface DynamicOAuthClientRegistration {
  clientId: string;
  clientSecret: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDynamicOAuthClientRegistration(value: unknown): DynamicOAuthClientRegistration {
  if (!isRecord(value) || typeof value["client_id"] !== "string" || !isTruthy(value["client_id"])) {
    throw new Error("OAuth dynamic registration did not return client_id.");
  }

  const clientSecret = value["client_secret"];

  if (clientSecret !== undefined && typeof clientSecret !== "string") {
    throw new Error("OAuth dynamic registration returned an invalid client_secret.");
  }

  return {
    clientId: value["client_id"],
    clientSecret: clientSecret ?? null,
  };
}

export async function registerDynamicOAuthClient(
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<DynamicOAuthClientRegistration> {
  if (!isTruthy(metadata.registration_endpoint)) {
    throw new Error("OAuth dynamic registration is not available.");
  }

  const response = await fetch(metadata.registration_endpoint, {
    body: JSON.stringify({
      client_name: "mosoo MCP",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("OAuth dynamic registration failed.");
  }

  return parseDynamicOAuthClientRegistration(await response.json());
}

export async function createPkcePair(): Promise<{ challenge: string; verifier: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = toBase64Url(verifierBytes);
  const challengeBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(verifier))),
  );

  return {
    challenge: toBase64Url(challengeBytes),
    verifier,
  };
}
