import { fetchChannelWebApi, readChannelWebApiJson } from "../channel-fetch";

export interface DiscordSendMessageInput {
  channelId: string;
  text: string;
}

export interface DiscordEditMessageInput {
  channelId: string;
  messageId: string;
  text: string;
}

export interface DiscordMessageReference {
  channelId: string;
  messageId: string;
}

type DiscordWebApiOperation =
  | "editMessage"
  | "getChannelType"
  | "getCurrentBotUser"
  | "sendMessage";

const DISCORD_ALLOWED_MENTIONS_DISABLED = { parse: [] } as const;

export class DiscordWebApiError extends Error {
  readonly code: string;
  readonly operation: DiscordWebApiOperation;

  constructor(operation: DiscordWebApiOperation, code: string) {
    super(`Discord ${operation} failed: ${code}`);
    this.code = code;
    this.name = "DiscordWebApiError";
    this.operation = operation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function readBoolean(value: unknown, key: string): boolean {
  return isRecord(value) && value[key] === true;
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) ? field : null;
}

function getDiscordErrorCode(
  response: Response,
  body: unknown,
  operation: DiscordWebApiOperation,
): string {
  const message = readString(body, "message");

  if (message) {
    return message;
  }

  return response.statusText.trim() || `${operation}_failed`;
}

export class DiscordWebApiClient {
  readonly #botToken: string;
  readonly #timeoutMs: number | undefined;

  constructor(botToken: string, options: { timeoutMs?: number } = {}) {
    this.#botToken = botToken;
    this.#timeoutMs = options.timeoutMs;
  }

  async getCurrentBotUser(): Promise<{
    bot: boolean;
    id: string;
    username: string | null;
  }> {
    const response = await fetchChannelWebApi({
      init: {
        headers: {
          Authorization: `Bot ${this.#botToken}`,
        },
        method: "GET",
      },
      label: "Discord users/@me",
      timeoutMs: this.#timeoutMs,
      url: "https://discord.com/api/v10/users/@me",
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok) {
      throw new DiscordWebApiError(
        "getCurrentBotUser",
        getDiscordErrorCode(response, body, "getCurrentBotUser"),
      );
    }

    const id = readString(body, "id");

    if (!id) {
      throw new Error("Discord current user response did not include a user id.");
    }

    return {
      bot: readBoolean(body, "bot"),
      id,
      username: readString(body, "username"),
    };
  }

  async getChannelType(input: { channelId: string }): Promise<number> {
    const response = await fetchChannelWebApi({
      init: {
        headers: {
          Authorization: `Bot ${this.#botToken}`,
        },
        method: "GET",
      },
      label: "Discord getChannelType",
      timeoutMs: this.#timeoutMs,
      url: `https://discord.com/api/v10/channels/${encodeURIComponent(input.channelId)}`,
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok) {
      throw new DiscordWebApiError(
        "getChannelType",
        getDiscordErrorCode(response, body, "getChannelType"),
      );
    }

    const channelType = readNumber(body, "type");

    if (channelType === null) {
      throw new Error("Discord channel response did not include a channel type.");
    }

    return channelType;
  }

  async sendMessage(input: DiscordSendMessageInput): Promise<DiscordMessageReference> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          allowed_mentions: DISCORD_ALLOWED_MENTIONS_DISABLED,
          content: input.text,
        }),
        headers: {
          Authorization: `Bot ${this.#botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Discord sendMessage",
      timeoutMs: this.#timeoutMs,
      url: `https://discord.com/api/v10/channels/${encodeURIComponent(input.channelId)}/messages`,
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok) {
      throw new DiscordWebApiError(
        "sendMessage",
        getDiscordErrorCode(response, body, "sendMessage"),
      );
    }

    const messageId = readString(body, "id");

    if (!messageId) {
      throw new Error("Discord send message response did not include a message id.");
    }

    return {
      channelId: input.channelId,
      messageId,
    };
  }

  async editMessage(input: DiscordEditMessageInput): Promise<void> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          allowed_mentions: DISCORD_ALLOWED_MENTIONS_DISABLED,
          content: input.text,
        }),
        headers: {
          Authorization: `Bot ${this.#botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "PATCH",
      },
      label: "Discord editMessage",
      timeoutMs: this.#timeoutMs,
      url: `https://discord.com/api/v10/channels/${encodeURIComponent(
        input.channelId,
      )}/messages/${encodeURIComponent(input.messageId)}`,
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok) {
      throw new DiscordWebApiError(
        "editMessage",
        getDiscordErrorCode(response, body, "editMessage"),
      );
    }
  }
}
