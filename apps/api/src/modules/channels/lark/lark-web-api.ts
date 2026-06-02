import { fetchChannelWebApi, readChannelWebApiJson } from "../channel-fetch";
import type { LarkDomain } from "./lark-events";

interface LarkApiBaseConfig {
  appId: string;
  appSecret: string;
  domain: LarkDomain;
  timeoutMs?: number;
}

interface LarkOpenApiResponse {
  code?: number;
  data?: unknown;
  msg?: string;
  // Feishu/Lark Open APIs return endpoint-specific payloads at the top level
  // (e.g. `tenant_access_token`, `bot`), not always wrapped under `data`.
  // Allow indexed access so callers can read those fields without re-casting.
  [key: string]: unknown;
}

export type LarkWebApiOperation = "bot.info" | "im.message.reply" | "tenant_access_token";

export class LarkWebApiError extends Error {
  readonly apiCode: number | null;
  readonly apiMessage: string | null;
  readonly code: string;
  readonly operation: LarkWebApiOperation;

  constructor(input: {
    apiCode: number | null;
    apiMessage: string | null;
    code: string;
    operation: LarkWebApiOperation;
  }) {
    super(`Lark ${input.operation} failed: ${input.apiMessage ?? input.code}`);
    this.apiCode = input.apiCode;
    this.apiMessage = input.apiMessage;
    this.code = input.code;
    this.name = "LarkWebApiError";
    this.operation = input.operation;
  }
}

const LARK_PERMISSION_ERROR_CODES = new Set([
  230001, // Bot not in chat.
  230035, // Send Message Permission deny.
]);

export function isLarkCredentialScopedError(error: LarkWebApiError): boolean {
  if (error.operation === "tenant_access_token" || error.operation === "bot.info") {
    return true;
  }

  if (error.apiCode !== null && LARK_PERMISSION_ERROR_CODES.has(error.apiCode)) {
    return true;
  }

  const message = (error.apiMessage ?? error.code).toLowerCase();
  return (
    message.includes("access denied") ||
    message.includes("forbidden") ||
    message.includes("not authorized") ||
    message.includes("permission") ||
    message.includes("scope") ||
    message.includes("token")
  );
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

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) ? field : null;
}

export function toLarkApiOrigin(domain: LarkDomain): string {
  return domain === "feishu" ? "https://open.feishu.cn" : "https://open.larksuite.com";
}

async function readLarkResponse(
  response: Response,
  operation: LarkWebApiOperation,
): Promise<LarkOpenApiResponse> {
  const parsed = await readChannelWebApiJson(response);

  if (!isRecord(parsed)) {
    const code = response.statusText.trim() || `${operation}_failed`;
    throw new LarkWebApiError({
      apiCode: null,
      apiMessage: null,
      code,
      operation,
    });
  }

  const body = parsed as LarkOpenApiResponse;
  const apiCode = readNumber(body, "code");
  const apiMessage = readString(body, "msg");

  if (!response.ok || body.code !== 0) {
    throw new LarkWebApiError({
      apiCode,
      apiMessage,
      code: apiCode === null ? (apiMessage ?? `${operation}_failed`) : `lark_${apiCode}`,
      operation,
    });
  }

  return body;
}

export class LarkWebApiClient {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #origin: string;
  readonly #timeoutMs: number | undefined;

  constructor(config: LarkApiBaseConfig) {
    this.#appId = config.appId;
    this.#appSecret = config.appSecret;
    this.#origin = toLarkApiOrigin(config.domain);
    this.#timeoutMs = config.timeoutMs;
  }

  async getTenantAccessToken(): Promise<string> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          app_id: this.#appId,
          app_secret: this.#appSecret,
        }),
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Lark tenant_access_token",
      timeoutMs: this.#timeoutMs,
      url: `${this.#origin}/open-apis/auth/v3/tenant_access_token/internal`,
    });
    const body = await readLarkResponse(response, "tenant_access_token");
    // Per Feishu/Lark docs the token is returned at the top level alongside
    // `code`, `msg`, `expire` — it is NOT nested under a `data` envelope.
    const token = readString(body, "tenant_access_token");

    if (!token) {
      throw new Error("Lark tenant_access_token response did not include a token.");
    }

    return token;
  }

  async getBotInfo(tenantAccessToken: string): Promise<{
    appName: string | null;
    botOpenId: string;
  }> {
    const response = await fetchChannelWebApi({
      init: {
        headers: {
          Authorization: `Bearer ${tenantAccessToken}`,
        },
        method: "GET",
      },
      label: "Lark bot.info",
      timeoutMs: this.#timeoutMs,
      url: `${this.#origin}/open-apis/bot/v3/info`,
    });
    const body = await readLarkResponse(response, "bot.info");
    // The `bot` object is at the top level of the response (verified against
    // the official larksuite/oapi-sdk-go bindings), not under `data`.
    const bot = body["bot"];
    const botOpenId = readString(bot, "open_id");

    if (!botOpenId) {
      throw new Error("Lark bot info response did not include bot.open_id.");
    }

    return {
      appName: readString(bot, "app_name") ?? readString(bot, "name"),
      botOpenId,
    };
  }

  async replyMessage(input: {
    messageId: string;
    tenantAccessToken: string;
    text: string;
  }): Promise<void> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          content: JSON.stringify({ text: input.text }),
          msg_type: "text",
        }),
        headers: {
          Authorization: `Bearer ${input.tenantAccessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Lark im.message.reply",
      timeoutMs: this.#timeoutMs,
      url: `${this.#origin}/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}/reply`,
    });
    await readLarkResponse(response, "im.message.reply");
  }
}
