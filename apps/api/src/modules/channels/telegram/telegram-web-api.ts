import { fetchChannelWebApi, readChannelWebApiJson } from "../channel-fetch";

export interface TelegramSendMessageInput {
  chatId: string;
  messageThreadId: number | null;
  text: string;
}

export interface TelegramMessageReference {
  chatId: string;
  messageId: number;
}

interface TelegramWebApiOkResponse {
  ok: true;
  result?: unknown;
}

interface TelegramWebApiErrorResponse {
  description?: string;
  ok: false;
}

type TelegramWebApiResponse = TelegramWebApiErrorResponse | TelegramWebApiOkResponse;

type TelegramWebApiOperation = "getMe" | "sendMessage";

export class TelegramWebApiError extends Error {
  readonly code: string;
  readonly operation: TelegramWebApiOperation;

  constructor(operation: TelegramWebApiOperation, code: string) {
    super(`Telegram ${operation} failed: ${code}`);
    this.code = code;
    this.name = "TelegramWebApiError";
    this.operation = operation;
  }
}

export function isTelegramCredentialScopedError(error: TelegramWebApiError): boolean {
  if (error.operation === "getMe") {
    return true;
  }

  const code = error.code.toLowerCase();

  return code.includes("unauthorized") || code.includes("token");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTelegramWebApiResponse(value: unknown): value is TelegramWebApiResponse {
  if (!isRecord(value)) {
    return false;
  }

  const ok = value["ok"];
  return ok === true || ok === false;
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) ? field : null;
}

function getTelegramErrorCode(
  response: Response,
  body: unknown,
  operation: TelegramWebApiOperation,
): string {
  if (isTelegramWebApiResponse(body) && !body.ok && typeof body.description === "string") {
    return body.description;
  }

  return response.statusText.trim() || `${operation}_failed`;
}

export class TelegramWebApiClient {
  readonly #botToken: string;
  readonly #timeoutMs: number | undefined;

  constructor(botToken: string, options: { timeoutMs?: number } = {}) {
    this.#botToken = botToken;
    this.#timeoutMs = options.timeoutMs;
  }

  async getMe(): Promise<{
    firstName: string | null;
    id: string;
    username: string | null;
  }> {
    const response = await fetchChannelWebApi({
      init: {
        method: "POST",
      },
      label: "Telegram getMe",
      timeoutMs: this.#timeoutMs,
      url: `https://api.telegram.org/bot${this.#botToken}/getMe`,
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok || !isTelegramWebApiResponse(body) || !body.ok) {
      throw new TelegramWebApiError("getMe", getTelegramErrorCode(response, body, "getMe"));
    }

    const id = readNumber(body.result, "id");

    if (id === null) {
      throw new Error("Telegram getMe response did not include a bot id.");
    }

    return {
      firstName: readString(body.result, "first_name"),
      id: String(id),
      username: readString(body.result, "username"),
    };
  }

  async sendMessage(input: TelegramSendMessageInput): Promise<TelegramMessageReference> {
    const body: Record<string, unknown> = {
      chat_id: input.chatId,
      text: input.text,
    };

    if (input.messageThreadId !== null) {
      body["message_thread_id"] = input.messageThreadId;
    }

    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Telegram sendMessage",
      timeoutMs: this.#timeoutMs,
      url: `https://api.telegram.org/bot${this.#botToken}/sendMessage`,
    });
    const parsed = await readChannelWebApiJson(response);

    if (!response.ok || !isTelegramWebApiResponse(parsed) || !parsed.ok) {
      throw new TelegramWebApiError(
        "sendMessage",
        getTelegramErrorCode(response, parsed, "sendMessage"),
      );
    }

    const messageId = readNumber(parsed.result, "message_id");

    if (messageId === null) {
      throw new Error("Telegram sendMessage response did not include a message id.");
    }

    return {
      chatId: input.chatId,
      messageId,
    };
  }
}
