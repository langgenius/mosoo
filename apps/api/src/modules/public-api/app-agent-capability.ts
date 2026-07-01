/**
 * Self-authorizing capability token for a deployed App's bound Agent.
 *
 * A deployed app reads one injected env var per binding whose value is a URL
 * carrying this token. The token encodes (appId, agentId, expose) and is signed
 * with an HMAC secret, so the bound app needs no API key — the URL itself is the
 * grant (PM decision #1, docs/prd/app-deployment.md "Agent Binding Wedge").
 *
 * Stateless by design: no DB row, no token table. Revocation in v0 is implicit
 * (the Agent must still be `published`, re-checked at call time by the ask
 * endpoint) plus the embedded expiry. Uses Web Crypto so it runs on Workers.
 */

export type AppAgentCapabilityExpose = "public_thread";

export interface AppAgentCapabilityClaims {
  agentId: string;
  appId: string;
  /** Absolute expiry, epoch milliseconds. */
  exp: number;
  expose: AppAgentCapabilityExpose;
}

const HMAC_PARAMS: HmacKeyGenParams = { hash: "SHA-256", name: "HMAC" };

/** Path the deployed app's injected URL points at (the capability ask endpoint). */
export const APP_AGENT_BOUND_PATH_PREFIX = "/api/v1/bound";

/** Strip trailing slashes without a backtracking regex (avoids ReDoS on library input). */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) {
    end -= 1;
  }
  return value.slice(0, end);
}

/** Build the self-authorizing URL injected as a bound agent's env var. */
export function boundAgentUrl(apiOrigin: string, token: string): string {
  return `${stripTrailingSlashes(apiOrigin)}${APP_AGENT_BOUND_PATH_PREFIX}/${token}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), HMAC_PARAMS, false, [
    "sign",
    "verify",
  ]);
}

function isCapabilityClaims(value: unknown): value is AppAgentCapabilityClaims {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["agentId"] === "string" &&
    typeof record["appId"] === "string" &&
    typeof record["exp"] === "number" &&
    record["expose"] === "public_thread"
  );
}

/** Mint a signed, URL-safe capability token for a bound agent. */
export async function mintAppAgentCapabilityToken(
  secret: string,
  claims: AppAgentCapabilityClaims,
): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    HMAC_PARAMS.name,
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify a capability token and return its claims, or null when the signature is
 * invalid, the token is malformed, or it has expired at `nowMs`.
 */
export async function verifyAppAgentCapabilityToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<AppAgentCapabilityClaims | null> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return null;
  }
  const payload = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);

  let signatureValid: boolean;
  try {
    const key = await importSigningKey(secret);
    signatureValid = await crypto.subtle.verify(
      HMAC_PARAMS.name,
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!signatureValid) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
  if (!isCapabilityClaims(parsed) || parsed.exp <= nowMs) {
    return null;
  }
  return parsed;
}
