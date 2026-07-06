import type { AccountId, McpOAuthFlowId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { fromBase64Url, toArrayBuffer, toBase64Url } from "../../../shared/bytes";
import { isTruthy } from "../../../shared/truthiness";
import { readAccountId, readMcpOAuthFlowId } from "./mcp-platform-ids";

interface OAuthStatePayload {
  flowId: McpOAuthFlowId;
  userId: AccountId;
}

function requireStateSecret(bindings: ApiBindings): string {
  const secret = bindings.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }

  return secret;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOAuthStatePayload(raw: string): OAuthStatePayload {
  const payload: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(raw)));

  if (!isRecord(payload) || typeof payload["flowId"] !== "string" || !payload["flowId"]) {
    throw new Error("OAuth state payload is invalid.");
  }

  if (typeof payload["userId"] !== "string" || !payload["userId"]) {
    throw new Error("OAuth state payload is invalid.");
  }

  return {
    flowId: readMcpOAuthFlowId(payload["flowId"]),
    userId: readAccountId(payload["userId"], "userId"),
  };
}

export async function createSignedOAuthState(
  bindings: ApiBindings,
  payload: OAuthStatePayload,
): Promise<string> {
  const base = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(requireStateSecret(bindings))),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(new TextEncoder().encode(base)),
  );

  return `${base}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySignedOAuthState(
  bindings: ApiBindings,
  rawState: string,
): Promise<OAuthStatePayload> {
  const [encodedPayload, encodedSignature] = rawState.split(".");

  if (!isTruthy(encodedPayload) || !isTruthy(encodedSignature)) {
    throw new Error("OAuth state is invalid.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(requireStateSecret(bindings))),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(fromBase64Url(encodedSignature)),
    toArrayBuffer(new TextEncoder().encode(encodedPayload)),
  );

  if (!verified) {
    throw new Error("OAuth state signature is invalid.");
  }

  return parseOAuthStatePayload(encodedPayload);
}
