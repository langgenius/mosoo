import { toArrayBuffer, toBase64Url } from "../../../shared/bytes";

export const RUNTIME_MCP_DELEGATION_HEADER = "X-Mosoo-Delegation";
export const RUNTIME_MCP_TOOL_CALL_ID_HEADER = "X-Mosoo-Tool-Call-Id";
const TOOL_CALL_ID_MAX_LENGTH = 255;
const ISSUER = "mosoo";
const LIFETIME_SECONDS = 60;

interface RuntimeMcpDelegationClaims {
  // app_id is a frozen v1 wire claim consumed by external MCP servers.
  act: { agent_id: string; app_id: string };
  aud: string;
  exp: number;
  iat: number;
  iss: typeof ISSUER;
  jti: string;
  run_id: string | null;
  sub: string;
  thread_id: string;
  tool_call_id: string | null;
}

interface DelegationInput {
  accessToken: string;
  audience: string;
  claims: {
    agentId: string;
    projectId: string;
    runId: string | null;
    threadId: string;
    endUserId: string;
    toolCallId: string | null;
  };
  nowMs?: number;
}

const encoder = new TextEncoder();

async function signingKey(accessToken: string): Promise<CryptoKey> {
  const material = encoder.encode(`mosoo-mcp-delegation-v1\0${accessToken}`);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(material));
  return crypto.subtle.importKey("raw", digest, { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
}

export async function createRuntimeMcpDelegationToken(input: DelegationInput): Promise<string> {
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: RuntimeMcpDelegationClaims = {
    act: { agent_id: input.claims.agentId, app_id: input.claims.projectId },
    aud: input.audience,
    exp: now + LIFETIME_SECONDS,
    iat: now,
    iss: ISSUER,
    jti: crypto.randomUUID(),
    run_id: input.claims.runId,
    sub: input.claims.endUserId,
    thread_id: input.claims.threadId,
    tool_call_id: input.claims.toolCallId,
  };
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(input.accessToken),
    toArrayBuffer(encoder.encode(signingInput)),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export function readRuntimeMcpToolCallId(headers: Headers): string | null {
  const value = headers.get(RUNTIME_MCP_TOOL_CALL_ID_HEADER);

  if (value === null) {
    return null;
  }

  const toolCallId = value.trim();

  if (toolCallId.length === 0 || toolCallId.length > TOOL_CALL_ID_MAX_LENGTH) {
    throw new TypeError("MCP tool call ID header is invalid.");
  }

  return toolCallId;
}
