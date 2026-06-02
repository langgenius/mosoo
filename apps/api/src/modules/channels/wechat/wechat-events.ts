import type { ChannelBindingId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";
import { createWeChatReplyRoute } from "./wechat-runtime";
import type { WeChatReplyRoute } from "./wechat-runtime";

const WECHAT_ILINK_RET_SESSION_EXPIRED = -14;
const WECHAT_MESSAGE_TYPE_USER = 1;
const WECHAT_MESSAGE_TYPE_BOT = 2;
const WECHAT_MESSAGE_STATE_FINISH = 2;
const WECHAT_MESSAGE_ITEM_TEXT = 1;

interface WeChatIlinkMessageItem {
  text: string | null;
  type: number | null;
}

export interface WeChatIlinkRawMessage {
  chatRoomId: string | null;
  clientId: string | null;
  contextToken: string;
  createTimeMs: number | null;
  fromUserId: string;
  itemList: WeChatIlinkMessageItem[];
  messageId: string;
  messageState: number | null;
  messageType: number;
  msgType: number | null;
  roomId: string | null;
  toUserId: string;
}

export interface WeChatIlinkPollEnvelope {
  errcode: number | null;
  errmsg: string | null;
  messages: WeChatIlinkRawMessage[];
  nextCursor: string;
  ret: number | null;
  suggestedLongPollTimeoutMs: number | null;
}

export interface WeChatIlinkWorkTrigger {
  eventId: string;
  externalActorId: string;
  externalMessageId: string;
  externalThreadId: string;
  messageId: string;
  peerId: string;
  replyRoute: WeChatReplyRoute;
  text: string;
}

export interface WeChatProviderMetadata {
  [key: string]: string | number | boolean | null;
  chatType: "dm";
  peerId: string;
}

export interface WeChatPollRuntimeSummary {
  nextCursor: string | null;
  reason: string | null;
  status: "ok" | "provider_error" | "relogin_required";
}

export interface WeChatIlinkPollParseFailure {
  code: "invalid_json" | "invalid_messages" | "missing_response";
  message: string;
  ok: false;
}

export interface WeChatIlinkPollParseSuccess {
  envelope: WeChatIlinkPollEnvelope;
  ok: true;
}

export type WeChatIlinkPollParseResult = WeChatIlinkPollParseFailure | WeChatIlinkPollParseSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function readStringOrNumberAsString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }

  if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
    return String(candidate);
  }

  return null;
}

function readMessageItem(value: unknown): WeChatIlinkMessageItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = readNumber(value, "type");
  if (type === null) {
    return null;
  }

  const textItem = value["text_item"];

  return {
    text: isRecord(textItem) ? readString(textItem, "text") : null,
    type,
  };
}

function readMessageItems(value: unknown): WeChatIlinkMessageItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items: WeChatIlinkMessageItem[] = [];

  for (const item of value) {
    const parsed = readMessageItem(item);

    if (!parsed) {
      return null;
    }

    items.push(parsed);
  }

  return items;
}

function readRawMessage(value: unknown): WeChatIlinkRawMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const contextToken = readString(value, "context_token");
  const fromUserId = readString(value, "from_user_id");
  const messageId = readStringOrNumberAsString(value, "message_id");
  const messageItems = readMessageItems(value["item_list"]);
  const messageState = readNumber(value, "message_state");
  const messageType = readNumber(value, "message_type");
  const toUserId = readString(value, "to_user_id");

  if (
    !contextToken ||
    !fromUserId ||
    !messageId ||
    !messageItems ||
    messageState === null ||
    messageType === null ||
    !toUserId
  ) {
    return null;
  }

  return {
    chatRoomId: readString(value, "chat_room_id"),
    clientId: readString(value, "client_id"),
    contextToken,
    createTimeMs: readNumber(value, "create_time_ms"),
    fromUserId,
    itemList: messageItems,
    messageId,
    messageState,
    messageType,
    msgType: readNumber(value, "msg_type"),
    roomId: readString(value, "room_id"),
    toUserId,
  };
}

function readMessages(value: unknown): WeChatIlinkRawMessage[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages: WeChatIlinkRawMessage[] = [];

  for (const item of value) {
    const message = readRawMessage(item);

    if (!message) {
      return null;
    }

    messages.push(message);
  }

  return messages;
}

function extractText(items: WeChatIlinkMessageItem[]): string {
  return items
    .filter((item) => item.type === WECHAT_MESSAGE_ITEM_TEXT && item.text !== null)
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function hasExplicitGroupShape(message: WeChatIlinkRawMessage): boolean {
  return Boolean(message.roomId || message.chatRoomId);
}

function isSessionExpiredCode(value: number | null): boolean {
  return value === WECHAT_ILINK_RET_SESSION_EXPIRED;
}

// iLink ships `message_id` (and related identifiers) as JSON integers that exceed
// Number.MAX_SAFE_INTEGER (2^53 - 1), so JSON.parse silently rounds them and the
// rounded value reads back as not-a-safe-integer. Quote any unsigned integer with
// 16+ digits at a JSON value position so it round-trips losslessly as a string.
function quoteUnsafeJsonIntegers(body: string): string {
  return body.replace(/([:[,]\s*)(\d{16,})(\s*[,}\]])/g, '$1"$2"$3');
}

export function parseWeChatIlinkPollEnvelope(body: string): WeChatIlinkPollParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(quoteUnsafeJsonIntegers(body));
  } catch {
    return {
      code: "invalid_json",
      message: "WeChat iLink poll body must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      code: "invalid_json",
      message: "WeChat iLink poll body must be a JSON object.",
      ok: false,
    };
  }

  const errcode = readNumber(parsed, "errcode");
  const ret = readNumber(parsed, "ret");
  const nextCursor = readString(parsed, "get_updates_buf");
  const parsedMessages = readMessages(parsed["msgs"]);
  const providerReturnedError = (ret !== null && ret !== 0) || (errcode !== null && errcode !== 0);

  if (nextCursor === null) {
    return {
      code: "missing_response",
      message: "WeChat iLink poll body must include get_updates_buf.",
      ok: false,
    };
  }

  if (!providerReturnedError && !parsedMessages) {
    return {
      code: "invalid_messages",
      message: "WeChat iLink poll body must include a valid msgs array.",
      ok: false,
    };
  }

  return {
    envelope: {
      errcode,
      errmsg: readString(parsed, "errmsg"),
      messages: parsedMessages ?? [],
      nextCursor,
      ret,
      suggestedLongPollTimeoutMs: readNumber(parsed, "longpolling_timeout_ms"),
    },
    ok: true,
  };
}

export function summarizeWeChatPollRuntime(
  envelope: WeChatIlinkPollEnvelope,
): WeChatPollRuntimeSummary {
  if (isSessionExpiredCode(envelope.ret) || isSessionExpiredCode(envelope.errcode)) {
    return {
      nextCursor: null,
      reason: "session_expired",
      status: "relogin_required",
    };
  }

  if (
    (envelope.ret !== null && envelope.ret !== 0) ||
    (envelope.errcode !== null && envelope.errcode !== 0)
  ) {
    return {
      nextCursor: null,
      reason: envelope.errmsg ?? "provider_error",
      status: "provider_error",
    };
  }

  return {
    nextCursor: envelope.nextCursor,
    reason: null,
    status: "ok",
  };
}

export function normalizeWeChatIlinkWorkTrigger(
  message: WeChatIlinkRawMessage,
  input: {
    accountId: string;
    bindingId: ChannelBindingId;
    botId: string;
  },
): WeChatIlinkWorkTrigger | null {
  if (message.messageType === WECHAT_MESSAGE_TYPE_BOT) {
    return null;
  }

  if (message.messageType !== WECHAT_MESSAGE_TYPE_USER) {
    return null;
  }

  if (message.messageState !== null && message.messageState !== WECHAT_MESSAGE_STATE_FINISH) {
    return null;
  }

  if (hasExplicitGroupShape(message) || message.toUserId !== input.botId) {
    return null;
  }

  const text = extractText(message.itemList);

  if (!isTruthy(text)) {
    return null;
  }

  const replyRoute = createWeChatReplyRoute({
    accountId: input.accountId,
    bindingId: input.bindingId,
    contextToken: message.contextToken,
    peerId: message.fromUserId,
  });

  return {
    eventId: `wechat:message:${message.messageId}`,
    externalActorId: `wechat:user:${message.fromUserId}`,
    externalMessageId: `${message.fromUserId}:${message.messageId}`,
    externalThreadId: `wechat:dm:${message.fromUserId}`,
    messageId: message.messageId,
    peerId: message.fromUserId,
    replyRoute,
    text,
  };
}

export function createWeChatProviderMetadata(
  trigger: WeChatIlinkWorkTrigger,
): WeChatProviderMetadata {
  return {
    chatType: "dm",
    peerId: trigger.peerId,
  };
}
