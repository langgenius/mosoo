import { isTruthy } from "../../../shared/truthiness";

export const LARK_EVENT_TYPE_RECEIVE_MESSAGE = "im.message.receive_v1";

export type LarkDomain = "feishu" | "lark";

interface LarkEventHeader {
  eventId: string;
  eventType: string;
  tenantKey: string;
  token: string | null;
}

interface LarkReceiveMessageEvent {
  chatId: string;
  chatType: string | null;
  messageId: string;
  parentId: string | null;
  rootId: string | null;
  senderOpenId: string;
  senderType: string;
  senderUnionId: string | null;
  senderUserId: string | null;
  text: string;
}

export interface LarkUrlVerificationEnvelope {
  challenge: string;
  type: "url_verification";
}

export interface LarkEventCallbackEnvelope {
  event: LarkReceiveMessageEvent;
  header: LarkEventHeader;
  type: "event_callback";
}

export type LarkEventsEnvelope = LarkEventCallbackEnvelope | LarkUrlVerificationEnvelope;

export interface LarkWorkTrigger {
  chatId: string;
  chatType: string | null;
  eventId: string;
  externalActorId: string;
  externalMessageId: string;
  externalThreadId: string;
  messageId: string;
  parentId: string | null;
  rootId: string | null;
  senderOpenId: string;
  senderType: string;
  senderUnionId: string | null;
  senderUserId: string | null;
  tenantKey: string;
  text: string;
}

export interface LarkEventsParseInput {
  verificationToken: string;
}

export interface LarkEventsParseFailure {
  code:
    | "invalid_json"
    | "missing_challenge"
    | "missing_event"
    | "missing_header"
    | "token_mismatch"
    | "unsupported_type";
  message: string;
  ok: false;
}

export interface LarkEventsParseSuccess {
  envelope: LarkEventsEnvelope;
  ok: true;
}

export type LarkEventsParseResult = LarkEventsParseFailure | LarkEventsParseSuccess;

export interface LarkEventCallbackDecodeFailure {
  code: "invalid_envelope" | "missing_event" | "missing_header" | "unsupported_type";
  message: string;
  ok: false;
}

export interface LarkEventCallbackDecodeSuccess {
  envelope: LarkEventCallbackEnvelope;
  ok: true;
}

export type LarkEventCallbackDecodeResult =
  | LarkEventCallbackDecodeFailure
  | LarkEventCallbackDecodeSuccess;

export interface LarkEventsBodyReadFailure {
  code: "decrypt_failed" | "invalid_encrypt";
  message: string;
  ok: false;
}

export interface LarkEventsBodyReadSuccess {
  body: string;
  encrypted: boolean;
  ok: true;
}

export type LarkEventsBodyReadResult = LarkEventsBodyReadFailure | LarkEventsBodyReadSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readOptionalRecord(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const candidate = value[field];
  return isRecord(candidate) ? candidate : {};
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function trimToJsonObject(value: string): string {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Lark encrypted payload did not contain a JSON object.");
  }

  return value.slice(start, end + 1);
}

async function decryptLarkEncryptedPayload(input: {
  encrypt: string;
  encryptKey: string;
}): Promise<string> {
  const encryptedBytes = base64ToBytes(input.encrypt);

  if (encryptedBytes.length <= 16) {
    throw new Error("Lark encrypted payload is too short.");
  }

  const encoder = new TextEncoder();
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(input.encryptKey));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "decrypt",
  ]);
  const decrypted = await crypto.subtle.decrypt(
    { iv: encryptedBytes.slice(0, 16), name: "AES-CBC" },
    key,
    encryptedBytes.slice(16),
  );

  return trimToJsonObject(new TextDecoder().decode(decrypted));
}

function readTextContent(rawContent: string | null): string {
  if (!isTruthy(rawContent)) {
    return "";
  }

  try {
    const parsed: unknown = JSON.parse(rawContent);

    if (isRecord(parsed)) {
      const text = readString(parsed, "text");
      return text ?? "";
    }
  } catch {
    return rawContent;
  }

  return "";
}

function stripLeadingMention(text: string): string {
  return text.replace(/^@\S+\s*/u, "").trim();
}

export async function readLarkEventsBody(input: {
  body: string;
  encryptKey: string;
}): Promise<LarkEventsBodyReadResult> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input.body);
  } catch {
    return { body: input.body, encrypted: false, ok: true };
  }

  if (!isRecord(parsed) || !("encrypt" in parsed)) {
    return { body: input.body, encrypted: false, ok: true };
  }

  const encrypt = readString(parsed, "encrypt");

  if (!isTruthy(encrypt)) {
    return {
      code: "invalid_encrypt",
      message: "Lark encrypted event body must include an encrypt string.",
      ok: false,
    };
  }

  try {
    return {
      body: await decryptLarkEncryptedPayload({ encrypt, encryptKey: input.encryptKey }),
      encrypted: true,
      ok: true,
    };
  } catch {
    return {
      code: "decrypt_failed",
      message: "Lark encrypted event body could not be decrypted.",
      ok: false,
    };
  }
}

function readHeader(parsed: Record<string, unknown>): LarkEventHeader | null {
  const header = readOptionalRecord(parsed, "header");
  const eventId = readString(header, "event_id");
  const eventType = readString(header, "event_type");
  const tenantKey = readString(header, "tenant_key");

  if (!isTruthy(eventId) || !isTruthy(eventType) || !isTruthy(tenantKey)) {
    return null;
  }

  return {
    eventId,
    eventType,
    tenantKey,
    token: readString(header, "token"),
  };
}

function readReceiveMessageEvent(value: unknown): LarkReceiveMessageEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const message = readOptionalRecord(value, "message");
  const sender = readOptionalRecord(value, "sender");
  const senderId = readOptionalRecord(sender, "sender_id");
  const messageId = readString(message, "message_id");
  const chatId = readString(message, "chat_id");
  const senderOpenId = readString(senderId, "open_id");
  const senderType = readString(sender, "sender_type");

  if (
    !isTruthy(messageId) ||
    !isTruthy(chatId) ||
    !isTruthy(senderOpenId) ||
    !isTruthy(senderType)
  ) {
    return null;
  }

  return {
    chatId,
    chatType: readString(message, "chat_type"),
    messageId,
    parentId: readString(message, "parent_id"),
    rootId: readString(message, "root_id"),
    senderOpenId,
    senderType,
    senderUnionId: readString(senderId, "union_id"),
    senderUserId: readString(senderId, "user_id"),
    text: stripLeadingMention(readTextContent(readString(message, "content"))),
  };
}

function hasMatchingToken(input: {
  parsed: Record<string, unknown>;
  token: string | null;
  verificationToken: string;
}): boolean {
  const expected = input.verificationToken.trim();
  const topLevelToken = readString(input.parsed, "token");

  return input.token === expected || topLevelToken === expected;
}

export function decodeLarkEventCallbackEnvelope(parsed: unknown): LarkEventCallbackDecodeResult {
  if (!isRecord(parsed)) {
    return {
      code: "invalid_envelope",
      message: "Lark event_callback envelope must be a JSON object.",
      ok: false,
    };
  }

  const header = readHeader(parsed);

  if (!header) {
    return {
      code: "missing_header",
      message: "Lark event_callback header is required.",
      ok: false,
    };
  }

  if (header.eventType !== LARK_EVENT_TYPE_RECEIVE_MESSAGE) {
    return {
      code: "unsupported_type",
      message: "Lark event type is not supported by this adapter.",
      ok: false,
    };
  }

  const event = readReceiveMessageEvent(parsed["event"]);

  if (!event) {
    return {
      code: "missing_event",
      message: "Lark im.message.receive_v1 event is incomplete.",
      ok: false,
    };
  }

  return {
    envelope: {
      event,
      header,
      type: "event_callback",
    },
    ok: true,
  };
}

export function parseLarkEventsEnvelope(
  body: string,
  input: LarkEventsParseInput,
): LarkEventsParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      code: "invalid_json",
      message: "Lark request body must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      code: "invalid_json",
      message: "Lark request body must be a JSON object.",
      ok: false,
    };
  }

  if (parsed["type"] === "url_verification") {
    const challenge = readString(parsed, "challenge");
    const token = readString(parsed, "token");

    if (!isTruthy(challenge)) {
      return {
        code: "missing_challenge",
        message: "Lark url_verification challenge is required.",
        ok: false,
      };
    }

    if (!hasMatchingToken({ parsed, token, verificationToken: input.verificationToken })) {
      return {
        code: "token_mismatch",
        message: "Lark verification token is invalid.",
        ok: false,
      };
    }

    return {
      envelope: {
        challenge,
        type: "url_verification",
      },
      ok: true,
    };
  }

  const header = readHeader(parsed);

  if (!header) {
    return {
      code: "missing_header",
      message: "Lark event_callback header is required.",
      ok: false,
    };
  }

  if (
    !hasMatchingToken({ parsed, token: header.token, verificationToken: input.verificationToken })
  ) {
    return {
      code: "token_mismatch",
      message: "Lark verification token is invalid.",
      ok: false,
    };
  }

  if (header.eventType !== LARK_EVENT_TYPE_RECEIVE_MESSAGE) {
    return {
      code: "unsupported_type",
      message: "Lark event type is not supported by this adapter.",
      ok: false,
    };
  }

  const event = readReceiveMessageEvent(parsed["event"]);

  if (!event) {
    return {
      code: "missing_event",
      message: "Lark im.message.receive_v1 event is incomplete.",
      ok: false,
    };
  }

  return {
    envelope: {
      event,
      header,
      type: "event_callback",
    },
    ok: true,
  };
}

export function normalizeLarkWorkTrigger(envelope: LarkEventCallbackEnvelope): LarkWorkTrigger {
  const threadAnchor = envelope.event.rootId ?? envelope.event.parentId ?? envelope.event.messageId;

  return {
    chatId: envelope.event.chatId,
    chatType: envelope.event.chatType,
    eventId: `lark:event:${envelope.header.eventId}`,
    externalActorId: `lark:${envelope.event.senderOpenId}`,
    externalMessageId: envelope.event.messageId,
    externalThreadId: `${envelope.event.chatId}:${threadAnchor}`,
    messageId: envelope.event.messageId,
    parentId: envelope.event.parentId,
    rootId: envelope.event.rootId,
    senderOpenId: envelope.event.senderOpenId,
    senderType: envelope.event.senderType,
    senderUnionId: envelope.event.senderUnionId,
    senderUserId: envelope.event.senderUserId,
    tenantKey: envelope.header.tenantKey,
    text: envelope.event.text,
  };
}
