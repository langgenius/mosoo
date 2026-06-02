import { isTruthy } from "../../../shared/truthiness";

interface DiscordGatewayAuthor {
  bot: boolean;
  id: string;
  username: string | null;
}

interface DiscordGatewayMessage {
  author: DiscordGatewayAuthor;
  channelId: string;
  channelType: number | null;
  content: string;
  guildId: string | null;
  id: string;
}

export interface DiscordGatewayDispatchEnvelope {
  message: DiscordGatewayMessage;
  sequence: number;
  type: "MESSAGE_CREATE";
}

export interface DiscordWorkTrigger {
  authorDisplayName: string | null;
  authorId: string;
  channelId: string;
  channelType: number | null;
  eventId: string;
  externalActorId: string;
  externalMessageId: string;
  externalThreadId: string;
  guildId: string | null;
  messageId: string;
  text: string;
}

export interface DiscordGatewayDispatchParseFailure {
  code: "invalid_json" | "missing_message" | "missing_sequence" | "unsupported_dispatch";
  message: string;
  ok: false;
}

export interface DiscordGatewayDispatchParseSuccess {
  envelope: DiscordGatewayDispatchEnvelope;
  ok: true;
}

export type DiscordGatewayDispatchParseResult =
  | DiscordGatewayDispatchParseFailure
  | DiscordGatewayDispatchParseSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readMessageContent(value: Record<string, unknown>): string | null {
  const candidate = value["content"];
  return typeof candidate === "string" ? candidate : null;
}

function readBoolean(value: Record<string, unknown>, field: string): boolean {
  return value[field] === true;
}

function readNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function readRelayChannelType(value: Record<string, unknown>): number | null {
  return readNumber(value, "relay_channel_type");
}

function readAuthor(value: unknown): DiscordGatewayAuthor | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, "id");

  if (!id) {
    return null;
  }

  return {
    bot: readBoolean(value, "bot"),
    id,
    username: readString(value, "username"),
  };
}

function readGatewayMessage(value: unknown): DiscordGatewayMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const author = readAuthor(value["author"]);
  const channelId = readString(value, "channel_id");
  const content = readMessageContent(value);
  const id = readString(value, "id");

  if (!author || !channelId || content === null || !id) {
    return null;
  }

  return {
    author,
    channelId,
    channelType: readRelayChannelType(value),
    content,
    guildId: readString(value, "guild_id"),
    id,
  };
}

export function parseDiscordGatewayDispatchEnvelope(
  body: string,
): DiscordGatewayDispatchParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      code: "invalid_json",
      message: "Discord gateway dispatch body must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed) || parsed["op"] !== 0 || parsed["t"] !== "MESSAGE_CREATE") {
    return {
      code: "unsupported_dispatch",
      message: "Discord gateway dispatch type is not supported.",
      ok: false,
    };
  }

  const message = readGatewayMessage(parsed["d"]);
  const sequence = readNumber(parsed, "s");

  if (sequence === null) {
    return {
      code: "missing_sequence",
      message: "Discord MESSAGE_CREATE dispatch is missing a sequence.",
      ok: false,
    };
  }

  if (!message) {
    return {
      code: "missing_message",
      message: "Discord MESSAGE_CREATE dispatch is missing required fields.",
      ok: false,
    };
  }

  return {
    envelope: {
      message,
      sequence,
      type: "MESSAGE_CREATE",
    },
    ok: true,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionPattern(botUserId: string): RegExp {
  return new RegExp(`^<@!?${escapeRegExp(botUserId)}>\\s*`, "u");
}

export function normalizeDiscordGatewayWorkTrigger(
  envelope: DiscordGatewayDispatchEnvelope,
  input: { botUserId: string },
): DiscordWorkTrigger | null {
  const { message } = envelope;

  if (message.channelType === null) {
    return null;
  }

  if (message.author.bot || message.channelType === 3) {
    return null;
  }

  if (message.guildId === null && message.channelType !== 1) {
    return null;
  }

  let text = message.content.trim();

  if (message.guildId) {
    const pattern = mentionPattern(input.botUserId);

    if (!pattern.test(text)) {
      return null;
    }

    text = text.replace(pattern, "").trim();
  }

  if (!isTruthy(text)) {
    return null;
  }

  const externalThreadId = message.guildId
    ? `guild:${message.guildId}:channel:${message.channelId}:message:${message.id}`
    : `dm:${message.channelId}:message:${message.id}`;

  return {
    authorDisplayName: message.author.username,
    authorId: message.author.id,
    channelId: message.channelId,
    channelType: message.channelType,
    eventId: `discord:message:${message.id}`,
    externalActorId: `discord:user:${message.author.id}`,
    externalMessageId: `${message.channelId}:${message.id}`,
    externalThreadId,
    guildId: message.guildId,
    messageId: message.id,
    text,
  };
}
