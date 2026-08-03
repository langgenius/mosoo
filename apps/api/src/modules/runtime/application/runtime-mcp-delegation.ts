import { fromBase64Url, toArrayBuffer, toBase64Url } from "../../../shared/bytes";

export const RUNTIME_MCP_DELEGATION_HEADER = "X-Mosoo-Delegation";
const ISSUER = "mosoo";
const LIFETIME_SECONDS = 60;

export interface RuntimeMcpDelegationClaims {
  act: { agent_id: string; app_id: string };
  aud: string;
  exp: number;
  iat: number;
  iss: typeof ISSUER;
  jti: string;
  run_id: string | null;
  sub: string;
  thread_id: string;
}

interface DelegationInput {
  accessToken: string;
  audience: string;
  claims: {
    agentId: string;
    appId: string;
    runId: string | null;
    threadId: string;
    userId: string;
  };
  nowMs?: number;
}

const encoder = new TextEncoder();

async function signingKey(accessToken: string, usage: KeyUsage): Promise<CryptoKey> {
  if (accessToken.trim() === "") throw new Error("MCP access token is required for delegation.");
  const material = encoder.encode(`mosoo-mcp-delegation-v1\0${accessToken}`);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(material));
  return crypto.subtle.importKey("raw", digest, { hash: "SHA-256", name: "HMAC" }, false, [usage]);
}

export async function createRuntimeMcpDelegationToken(input: DelegationInput): Promise<string> {
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: RuntimeMcpDelegationClaims = {
    act: { agent_id: input.claims.agentId, app_id: input.claims.appId },
    aud: input.audience,
    exp: now + LIFETIME_SECONDS,
    iat: now,
    iss: ISSUER,
    jti: crypto.randomUUID(),
    run_id: input.claims.runId,
    sub: input.claims.userId,
    thread_id: input.claims.threadId,
  };
  if (!claims.sub || !claims.aud)
    throw new Error("MCP delegation subject and audience are required.");
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(input.accessToken, "sign"),
    toArrayBuffer(encoder.encode(signingInput)),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyRuntimeMcpDelegationToken(input: {
  accessToken: string;
  audience: string;
  nowMs?: number;
  token: string;
}): Promise<RuntimeMcpDelegationClaims> {
  const [header, payload, signature, extra] = input.token.split(".");
  if (!header || !payload || !signature || extra !== undefined)
    throw new Error("MCP delegation token format is invalid.");
  const parsedHeader = JSON.parse(new TextDecoder().decode(fromBase64Url(header))) as {
    alg?: unknown;
    typ?: unknown;
  };
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") {
    throw new Error("MCP delegation token header is invalid.");
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(input.accessToken, "verify"),
    toArrayBuffer(fromBase64Url(signature)),
    toArrayBuffer(encoder.encode(`${header}.${payload}`)),
  );
  if (!valid) throw new Error("MCP delegation token signature is invalid.");
  const claims = JSON.parse(
    new TextDecoder().decode(fromBase64Url(payload)),
  ) as RuntimeMcpDelegationClaims;
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (
    claims.iss !== ISSUER ||
    claims.aud !== input.audience ||
    typeof claims.sub !== "string" ||
    claims.sub === "" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    claims.iat > now + 5 ||
    claims.exp <= now ||
    claims.exp - claims.iat > LIFETIME_SECONDS ||
    typeof claims.thread_id !== "string" ||
    claims.thread_id === "" ||
    (claims.run_id !== null && (typeof claims.run_id !== "string" || claims.run_id === "")) ||
    typeof claims.act?.agent_id !== "string" ||
    typeof claims.act?.app_id !== "string"
  )
    throw new Error("MCP delegation token claims are invalid.");
  return claims;
}
