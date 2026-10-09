import type { AccountId, McpOAuthFlowId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { fromBase64Url, toArrayBuffer, toBase64Url } from "../../../shared/bytes";
import { isTruthy } from "../../../shared/truthiness";

interface OAuthStatePayload {
  flowId: McpOAuthFlowId;
  userId: AccountId;
}

async function importStateKey(bindings: ApiBindings): Promise<CryptoKey> {
  const secret = bindings.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }

  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

export async function createSignedOAuthState(
  bindings: ApiBindings,
  payload: OAuthStatePayload,
): Promise<string> {
  const base = toBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importStateKey(bindings),
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

  const verified = await crypto.subtle.verify(
    "HMAC",
    await importStateKey(bindings),
    toArrayBuffer(fromBase64Url(encodedSignature)),
    toArrayBuffer(new TextEncoder().encode(encodedPayload)),
  );

  if (!verified) {
    throw new Error("OAuth state signature is invalid.");
  }

  return JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as OAuthStatePayload;
}
