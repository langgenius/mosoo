export const MOSOO_DELEGATION_HEADER = "X-Mosoo-Delegation";

const DELEGATION_ISSUER = "mosoo";
const DELEGATION_KEY_PREFIX = "mosoo-mcp-delegation-v1\0";
const MAX_CLOCK_SKEW_SECONDS = 5;
const MAX_TOKEN_LIFETIME_SECONDS = 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type MosooDelegationVerificationErrorCode =
  | "invalid_claims"
  | "invalid_configuration"
  | "invalid_format"
  | "invalid_header"
  | "invalid_signature"
  | "missing_token";

export class MosooDelegationVerificationError extends Error {
  readonly code: MosooDelegationVerificationErrorCode;

  constructor(code: MosooDelegationVerificationErrorCode, message: string) {
    super(message);
    this.name = "MosooDelegationVerificationError";
    this.code = code;
  }
}

export interface MosooDelegationContext {
  agentId: string;
  appId: string;
  audience: string;
  expiresAt: Date;
  issuedAt: Date;
  runId: string | null;
  threadId: string;
  tokenId: string;
  userId: string;
}

export interface VerifyMosooDelegationInput {
  accessToken: string;
  audience: string;
  nowMs?: number;
  token: string | null | undefined;
}

interface DelegationClaims {
  act: { agent_id: string; app_id: string };
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  run_id: string | null;
  sub: string;
  thread_id: string;
}

function fail(code: MosooDelegationVerificationErrorCode, message: string): never {
  throw new MosooDelegationVerificationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteLength, byteOffset } = bytes;

  if (buffer instanceof ArrayBuffer) {
    return byteOffset === 0 && byteLength === buffer.byteLength
      ? buffer
      : buffer.slice(byteOffset, byteOffset + byteLength);
  }

  const copy = new Uint8Array(byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    fail("invalid_format", "Mosoo delegation token contains invalid base64url data.");
  }

  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  let binary: string;

  try {
    binary = atob(padded);
  } catch {
    fail("invalid_format", "Mosoo delegation token contains invalid base64url data.");
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? fail("invalid_format", "Invalid token data.");
  }

  return bytes;
}

function parseJsonSegment(value: string, code: MosooDelegationVerificationErrorCode): unknown {
  try {
    return JSON.parse(decoder.decode(decodeBase64Url(value))) as unknown;
  } catch (error) {
    if (error instanceof MosooDelegationVerificationError) {
      throw error;
    }

    fail(code, "Mosoo delegation token contains invalid JSON.");
  }
}

async function verificationKey(accessToken: string): Promise<CryptoKey> {
  if (accessToken.trim().length === 0) {
    fail("invalid_configuration", "MCP access token is required for delegation verification.");
  }

  const material = encoder.encode(`${DELEGATION_KEY_PREFIX}${accessToken}`);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(material));

  return crypto.subtle.importKey("raw", digest, { hash: "SHA-256", name: "HMAC" }, false, [
    "verify",
  ]);
}

function readClaims(value: unknown, audience: string, now: number): DelegationClaims {
  if (!isRecord(value) || !isRecord(value["act"])) {
    fail("invalid_claims", "Mosoo delegation token claims are invalid.");
  }

  const act = value["act"];
  const claims = {
    act: { agent_id: act["agent_id"], app_id: act["app_id"] },
    aud: value["aud"],
    exp: value["exp"],
    iat: value["iat"],
    iss: value["iss"],
    jti: value["jti"],
    run_id: value["run_id"],
    sub: value["sub"],
    thread_id: value["thread_id"],
  };

  if (
    claims.iss !== DELEGATION_ISSUER ||
    claims.aud !== audience ||
    !isNonEmptyString(claims.sub) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    (claims.iat as number) > now + MAX_CLOCK_SKEW_SECONDS ||
    (claims.exp as number) <= now ||
    (claims.exp as number) <= (claims.iat as number) ||
    (claims.exp as number) - (claims.iat as number) > MAX_TOKEN_LIFETIME_SECONDS ||
    !isNonEmptyString(claims.thread_id) ||
    (claims.run_id !== null && !isNonEmptyString(claims.run_id)) ||
    !isNonEmptyString(claims.act.agent_id) ||
    !isNonEmptyString(claims.act.app_id) ||
    !isNonEmptyString(claims.jti)
  ) {
    fail("invalid_claims", "Mosoo delegation token claims are invalid.");
  }

  return claims as DelegationClaims;
}

export async function verifyDelegation(
  input: VerifyMosooDelegationInput,
): Promise<MosooDelegationContext> {
  if (input.token === null || input.token === undefined || input.token.length === 0) {
    fail("missing_token", `Missing ${MOSOO_DELEGATION_HEADER} header.`);
  }

  if (input.audience.trim().length === 0) {
    fail("invalid_configuration", "Delegation audience is required.");
  }

  if (input.nowMs !== undefined && !Number.isFinite(input.nowMs)) {
    fail("invalid_configuration", "Delegation verification time must be finite.");
  }

  const [headerSegment, payloadSegment, signatureSegment, extraSegment] = input.token.split(".");

  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0 ||
    signatureSegment.length === 0 ||
    extraSegment !== undefined
  ) {
    fail("invalid_format", "Mosoo delegation token format is invalid.");
  }

  const header = parseJsonSegment(headerSegment, "invalid_header");

  if (!isRecord(header) || header["alg"] !== "HS256" || header["typ"] !== "JWT") {
    fail("invalid_header", "Mosoo delegation token header is invalid.");
  }

  const signature = decodeBase64Url(signatureSegment);
  const valid = await crypto.subtle.verify(
    "HMAC",
    await verificationKey(input.accessToken),
    toArrayBuffer(signature),
    toArrayBuffer(encoder.encode(`${headerSegment}.${payloadSegment}`)),
  );

  if (!valid) {
    fail("invalid_signature", "Mosoo delegation token signature is invalid.");
  }

  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const claims = readClaims(
    parseJsonSegment(payloadSegment, "invalid_claims"),
    input.audience,
    now,
  );

  return {
    agentId: claims.act.agent_id,
    appId: claims.act.app_id,
    audience: claims.aud,
    expiresAt: new Date(claims.exp * 1_000),
    issuedAt: new Date(claims.iat * 1_000),
    runId: claims.run_id,
    threadId: claims.thread_id,
    tokenId: claims.jti,
    userId: claims.sub,
  };
}
