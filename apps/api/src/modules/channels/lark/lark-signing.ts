import { isTruthy } from "../../../shared/truthiness";

const LARK_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export interface LarkSignatureVerificationInput {
  body: string;
  encryptKey: string;
  headers: Headers;
  nowMs?: number;
}

export interface LarkSignatureVerificationFailure {
  code: "invalid_timestamp" | "missing_header" | "signature_mismatch" | "stale_timestamp";
  message: string;
  ok: false;
  status: 400 | 401;
}

export interface LarkSignatureVerificationSuccess {
  ok: true;
}

export type LarkSignatureVerificationResult =
  | LarkSignatureVerificationFailure
  | LarkSignatureVerificationSuccess;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes.at(index) ?? 0) ^ (rightBytes.at(index) ?? 0);
  }

  return difference === 0;
}

async function computeLarkSignature(input: {
  body: string;
  encryptKey: string;
  nonce: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(input.timestamp + input.nonce + input.encryptKey + input.body),
  );

  return bytesToHex(digest);
}

function parseLarkTimestampMs(timestamp: string): number | null {
  if (!/^\d+$/.test(timestamp)) {
    return null;
  }

  const seconds = Number(timestamp);

  if (!Number.isSafeInteger(seconds)) {
    return null;
  }

  return seconds * 1000;
}

export async function verifyLarkSignature(
  input: LarkSignatureVerificationInput,
): Promise<LarkSignatureVerificationResult> {
  const timestamp = input.headers.get("x-lark-request-timestamp");
  const nonce = input.headers.get("x-lark-request-nonce");
  const signature = input.headers.get("x-lark-signature");

  if (!isTruthy(timestamp) || !isTruthy(nonce) || !isTruthy(signature)) {
    return {
      code: "missing_header",
      message: "Lark signature headers are required.",
      ok: false,
      status: 400,
    };
  }

  const timestampMs = parseLarkTimestampMs(timestamp);

  if (timestampMs === null) {
    return {
      code: "invalid_timestamp",
      message: "Lark signature timestamp must be an integer Unix timestamp.",
      ok: false,
      status: 400,
    };
  }

  const nowMs = input.nowMs ?? Date.now();

  if (Math.abs(nowMs - timestampMs) > LARK_SIGNATURE_MAX_SKEW_MS) {
    return {
      code: "stale_timestamp",
      message: "Lark request timestamp is outside the allowed window.",
      ok: false,
      status: 401,
    };
  }

  const expected = await computeLarkSignature({
    body: input.body,
    encryptKey: input.encryptKey,
    nonce,
    timestamp,
  });

  if (!timingSafeEqual(expected, signature)) {
    return {
      code: "signature_mismatch",
      message: "Lark request signature is invalid.",
      ok: false,
      status: 401,
    };
  }

  return { ok: true };
}
