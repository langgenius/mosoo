import { isTruthy } from "../../../shared/truthiness";

interface TelegramUser {
  first_name?: string;
  id: number;
  is_bot?: boolean;
  username?: string;
}

interface TelegramChat {
  id: number | string;
  title?: string;
  type?: string;
}

interface TelegramMessage {
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  message_id: number;
  message_thread_id?: number;
  sender_chat?: TelegramChat;
  text?: string;
}

export interface TelegramUpdateEnvelope {
  message: TelegramMessage;
  updateId: number;
}

export interface TelegramWorkTrigger {
  chatId: string;
  chatTitle: string | null;
  chatType: string | null;
  eventId: string;
  externalActorId: string;
  externalMessageId: string;
  externalThreadId: string;
  messageId: number;
  messageThreadId: number | null;
  text: string;
  userDisplayName: string | null;
  userId: string | null;
  username: string | null;
}

export interface TelegramUpdateParseFailure {
  code: "invalid_json" | "missing_message" | "missing_update_id";
  message: string;
  ok: false;
}

export interface TelegramUpdateParseSuccess {
  envelope: TelegramUpdateEnvelope;
  ok: true;
}

export type TelegramUpdateParseResult = TelegramUpdateParseFailure | TelegramUpdateParseSuccess;

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

function readChat(value: unknown): TelegramChat | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value["id"];

  if (!(typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id)))) {
    return null;
  }

  const chat: TelegramChat = {
    id,
  };
  const title = readString(value, "title");
  const type = readString(value, "type");

  if (title) {
    chat.title = title;
  }

  if (type) {
    chat.type = type;
  }

  return chat;
}

function readUser(value: unknown): TelegramUser | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNumber(value, "id");

  if (id === null) {
    return null;
  }

  const user: TelegramUser = {
    id,
    is_bot: value["is_bot"] === true,
  };
  const firstName = readString(value, "first_name");
  const username = readString(value, "username");

  if (firstName) {
    user.first_name = firstName;
  }

  if (username) {
    user.username = username;
  }

  return user;
}

function readMessage(value: unknown): TelegramMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const chat = readChat(value["chat"]);
  const messageId = readNumber(value, "message_id");

  if (!chat || messageId === null) {
    return null;
  }

  const messageThreadId = readNumber(value, "message_thread_id");

  const message: TelegramMessage = {
    chat,
    message_id: messageId,
  };
  const caption = readString(value, "caption");
  const from = readUser(value["from"]);
  const senderChat = readChat(value["sender_chat"]);
  const text = readString(value, "text");

  if (caption) {
    message.caption = caption;
  }

  if (from) {
    message.from = from;
  }

  if (messageThreadId !== null) {
    message.message_thread_id = messageThreadId;
  }

  if (senderChat) {
    message.sender_chat = senderChat;
  }

  if (text) {
    message.text = text;
  }

  return message;
}

function stripLeadingCommand(text: string): string {
  return text.replace(/^\/[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_]+)?\s*/u, "").trim();
}

export function parseTelegramUpdateEnvelope(body: string): TelegramUpdateParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      code: "invalid_json",
      message: "Telegram update body must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      code: "invalid_json",
      message: "Telegram update body must be a JSON object.",
      ok: false,
    };
  }

  const updateId = readNumber(parsed, "update_id");

  if (updateId === null) {
    return {
      code: "missing_update_id",
      message: "Telegram update_id is required.",
      ok: false,
    };
  }

  const message = readMessage(parsed["message"] ?? parsed["channel_post"]);

  if (!message) {
    return {
      code: "missing_message",
      message: "Telegram update does not contain a supported message.",
      ok: false,
    };
  }

  return {
    envelope: {
      message,
      updateId,
    },
    ok: true,
  };
}

export function normalizeTelegramWorkTrigger(
  envelope: TelegramUpdateEnvelope,
): TelegramWorkTrigger | null {
  const rawText = envelope.message.text ?? envelope.message.caption ?? "";
  const text = stripLeadingCommand(rawText);

  if (!isTruthy(text)) {
    return null;
  }

  const chatId = String(envelope.message.chat.id);
  const messageThreadId = envelope.message.message_thread_id ?? null;
  const threadPart = messageThreadId === null ? "main" : String(messageThreadId);
  const from = envelope.message.from;
  const senderChat = envelope.message.sender_chat;
  const actorId = from ? `telegram:user:${from.id}` : `telegram:chat:${senderChat?.id ?? chatId}`;

  return {
    chatId,
    chatTitle: envelope.message.chat.title ?? null,
    chatType: envelope.message.chat.type ?? null,
    eventId: `telegram:update:${envelope.updateId}`,
    externalActorId: actorId,
    externalMessageId: `${chatId}:${envelope.message.message_id}`,
    externalThreadId: `${chatId}:${threadPart}`,
    messageId: envelope.message.message_id,
    messageThreadId,
    text,
    userDisplayName: from?.first_name ?? null,
    userId: from ? String(from.id) : null,
    username: from?.username ?? null,
  };
}
