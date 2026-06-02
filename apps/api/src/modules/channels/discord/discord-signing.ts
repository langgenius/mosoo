import { isTruthy } from "../../../shared/truthiness";

const SIGNATURE_VERSION = "v0";
const MAX_CLOCK_SKEW_SECONDS = 60 * 5;
const DECIMAL_TIMESTAMP_PATTERN = /^\d+$/u;

export interface DiscordRelaySignatureVerificationInput {
  body: string;
  headers: Headers;
  nowSeconds?: number;
  relaySecret: string;
}

export interface DiscordRelaySignatureVerificationFailure {
  code: "missing_header" | "signature_mismatch" | "stale_timestamp";
  message: string;
  ok: false;
  status: 400 | 401;
}

export interface DiscordRelaySignatureVerificationSuccess {
  ok: true;
}

export type DiscordRelaySignatureVerificationResult =
  | DiscordRelaySignatureVerificationFailure
  | DiscordRelaySignatureVerificationSuccess;

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

export async function createDiscordRelaySignature(input: {
  body: string;
  relaySecret: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.relaySecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const baseString = `${SIGNATURE_VERSION}:${input.timestamp}:${input.body}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));

  return `${SIGNATURE_VERSION}=${bytesToHex(signature)}`;
}

export async function verifyDiscordRelaySignature(
  input: DiscordRelaySignatureVerificationInput,
): Promise<DiscordRelaySignatureVerificationResult> {
  const timestamp = input.headers.get("x-mosoo-discord-relay-timestamp");
  const signature = input.headers.get("x-mosoo-discord-relay-signature");

  if (!isTruthy(timestamp) || !isTruthy(signature)) {
    return {
      code: "missing_header",
      message: "Discord relay signature headers are required.",
      ok: false,
      status: 400,
    };
  }

  if (!DECIMAL_TIMESTAMP_PATTERN.test(timestamp)) {
    return {
      code: "missing_header",
      message: "Discord relay timestamp is invalid.",
      ok: false,
      status: 400,
    };
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);

  if (!Number.isSafeInteger(parsedTimestamp)) {
    return {
      code: "missing_header",
      message: "Discord relay timestamp is invalid.",
      ok: false,
      status: 400,
    };
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - parsedTimestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return {
      code: "stale_timestamp",
      message: "Discord relay timestamp is outside the accepted window.",
      ok: false,
      status: 401,
    };
  }

  const expected = await createDiscordRelaySignature({
    body: input.body,
    relaySecret: input.relaySecret,
    timestamp,
  });

  if (!timingSafeEqual(expected, signature)) {
    return {
      code: "signature_mismatch",
      message: "Discord relay signature is invalid.",
      ok: false,
      status: 401,
    };
  }

  return { ok: true };
}
