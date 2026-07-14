/**
 * Self-authorizing capability token for a deployed App's bound Agent.
 *
 * A deployed app reads one injected env var per binding whose value is a URL
 * carrying this token. The token encodes the App, Agent, deployment revision,
 * and binding that authorized it, and is signed with an HMAC secret, so the
 * bound app needs no API key — the URL itself is the grant (PM decision #1,
 * docs/prd/app-deployment.md "Agent Binding Wedge").
 *
 * The token remains stateless, but the ask endpoint re-checks its deployment
 * authority against D1 before starting a Run. Uses Web Crypto so it runs on
 * Workers.
 */

import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";
import { isPlatformId } from "@mosoo/id";

export type AppAgentCapabilityExpose = "public_thread";

export interface AppAgentCapabilityBinding {
  env: string;
  expose: AppAgentCapabilityExpose;
  name: string;
}

export interface AppAgentCapabilityClaims {
  agentId: AgentId;
  appId: AppId;
  binding: AppAgentCapabilityBinding;
  deploymentId: AppDeploymentId;
  deploymentRunId: AppDeploymentRunId;
  /** Absolute expiry, epoch milliseconds. */
  exp: number;
}

export type AppAgentCapabilityTokenVerification =
  | { claims: AppAgentCapabilityClaims; status: "expired" | "valid" }
  | { status: "invalid" };

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
  const binding = record["binding"];

  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
    return false;
  }

  const bindingRecord = binding as Record<string, unknown>;
  return (
    isPlatformId(record["agentId"]) &&
    isPlatformId(record["appId"]) &&
    isPlatformId(record["deploymentId"]) &&
    isPlatformId(record["deploymentRunId"]) &&
    typeof record["exp"] === "number" &&
    typeof bindingRecord["env"] === "string" &&
    bindingRecord["env"].length > 0 &&
    bindingRecord["expose"] === "public_thread" &&
    typeof bindingRecord["name"] === "string" &&
    bindingRecord["name"].length > 0
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
  const verification = await inspectAppAgentCapabilityToken(secret, token, nowMs);

  return verification.status === "valid" ? verification.claims : null;
}

/**
 * Verify a token while preserving the single safe diagnostic state: a
 * correctly signed capability whose authority has expired. Callers must keep
 * invalid capabilities indistinguishable to external clients.
 */
export async function inspectAppAgentCapabilityToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<AppAgentCapabilityTokenVerification> {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { status: "invalid" };
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
    return { status: "invalid" };
  }
  if (!signatureValid) {
    return { status: "invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return { status: "invalid" };
  }
  if (!isCapabilityClaims(parsed)) {
    return { status: "invalid" };
  }

  return { claims: parsed, status: parsed.exp <= nowMs ? "expired" : "valid" };
}
