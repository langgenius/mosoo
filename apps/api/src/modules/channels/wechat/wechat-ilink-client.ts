import { isTruthy } from "../../../shared/truthiness";
import { normalizeWeChatIlinkBaseUrl } from "./wechat-ilink-base-url";
import type { WeChatIlinkQrStatusResponse } from "./wechat-runtime";

const WECHAT_ILINK_CHANNEL_VERSION = "2.2.0";
const WECHAT_ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;
const WECHAT_ILINK_APP_ID = "bot";

const WECHAT_ILINK_ENDPOINT = {
  getBotQr: "ilink/bot/get_bot_qrcode",
  getQrStatus: "ilink/bot/get_qrcode_status",
  getUpdates: "ilink/bot/getupdates",
  sendMessage: "ilink/bot/sendmessage",
} as const;

interface WeChatIlinkBaseInfo {
  channel_version: string;
}

interface WeChatIlinkApiResult {
  errcode?: number;
  errmsg?: string;
  msg?: string;
  ret?: number;
}

interface WeChatIlinkSendMessagePayload {
  msg: {
    client_id: string;
    context_token: string;
    from_user_id: "";
    item_list: Array<{
      text_item: {
        text: string;
      };
      type: 1;
    }>;
    message_state: 2;
    message_type: 2;
    to_user_id: string;
  };
}

export interface WeChatIlinkClientOptions {
  baseUrl?: string;
  botToken?: string;
  fetchImpl?: typeof fetch;
  randomUin?: () => string;
}

export interface WeChatIlinkBotQrResponse {
  qrCodeImageContent: string | null;
  qrToken: string;
}

export interface WeChatIlinkGetUpdatesInput {
  cursor: string;
  timeoutMs: number;
}

export interface WeChatIlinkSendTextInput {
  clientId: string;
  contextToken: string;
  text: string;
  toUserId: string;
}

export class WeChatIlinkHttpError extends Error {
  readonly bodyPreview: string;
  readonly endpoint: string;
  readonly status: number;

  constructor(input: { bodyPreview: string; endpoint: string; status: number }) {
    super(`WeChat iLink ${input.endpoint} HTTP ${input.status}.`);
    this.name = "WeChatIlinkHttpError";
    this.bodyPreview = input.bodyPreview;
    this.endpoint = input.endpoint;
    this.status = input.status;
  }
}

export class WeChatIlinkApiError extends Error {
  readonly code: string;
  readonly endpoint: string;

  constructor(input: { code: string; endpoint: string; message: string }) {
    super(input.message);
    this.name = "WeChatIlinkApiError";
    this.code = input.code;
    this.endpoint = input.endpoint;
  }
}

function createRandomUin(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0]);
}

function endpointUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl}/${endpoint.replace(/^\/+/, "")}`;
}

function createRequestBody(payload: object): string {
  return JSON.stringify({
    ...payload,
    base_info: {
      channel_version: WECHAT_ILINK_CHANNEL_VERSION,
    } satisfies WeChatIlinkBaseInfo,
  });
}

function readApiResult(value: unknown): WeChatIlinkApiResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const result: WeChatIlinkApiResult = {};

  if (typeof record["errcode"] === "number") {
    result.errcode = record["errcode"];
  }

  if (typeof record["errmsg"] === "string") {
    result.errmsg = record["errmsg"];
  }

  if (typeof record["msg"] === "string") {
    result.msg = record["msg"];
  }

  if (typeof record["ret"] === "number") {
    result.ret = record["ret"];
  }

  return result;
}

function ensureIlinkOk(endpoint: string, value: unknown): void {
  const result = readApiResult(value);

  if (!result) {
    return;
  }

  const ret = result.ret ?? 0;
  const errcode = result.errcode ?? 0;

  if (ret === 0 && errcode === 0) {
    return;
  }

  const code = `ilink_${ret !== 0 ? ret : errcode}`;
  const message = result.errmsg ?? result.msg ?? "WeChat iLink API returned an error.";

  throw new WeChatIlinkApiError({
    code,
    endpoint,
    message: `WeChat iLink ${endpoint} failed: ${message}`,
  });
}

function parseJsonObject(body: string, endpoint: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WeChatIlinkApiError({
      code: "invalid_json",
      endpoint,
      message: `WeChat iLink ${endpoint} response must be valid JSON.`,
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WeChatIlinkApiError({
      code: "invalid_json",
      endpoint,
      message: `WeChat iLink ${endpoint} response must be a JSON object.`,
    });
  }

  return parsed as Record<string, unknown>;
}

export class WeChatIlinkClient {
  readonly #baseUrl: string;
  readonly #botToken: string | null;
  readonly #fetch: typeof fetch;
  readonly #randomUin: () => string;

  constructor(options: WeChatIlinkClientOptions = {}) {
    this.#baseUrl = normalizeWeChatIlinkBaseUrl(options.baseUrl);
    this.#botToken = options.botToken?.trim() || null;
    this.#fetch = options.fetchImpl ?? fetch.bind(globalThis);
    this.#randomUin = options.randomUin ?? createRandomUin;
  }

  async getBotQr(input: { botType?: string } = {}): Promise<WeChatIlinkBotQrResponse> {
    const botType = input.botType?.trim() || "3";
    const endpoint = `${WECHAT_ILINK_ENDPOINT.getBotQr}?bot_type=${encodeURIComponent(botType)}`;
    const response = await this.#get(endpoint, { timeoutMs: 35_000 });
    const qrToken = typeof response["qrcode"] === "string" ? response["qrcode"].trim() : "";

    if (!isTruthy(qrToken)) {
      throw new WeChatIlinkApiError({
        code: "missing_qrcode",
        endpoint: WECHAT_ILINK_ENDPOINT.getBotQr,
        message: "WeChat iLink QR response did not include qrcode.",
      });
    }

    return {
      qrCodeImageContent:
        typeof response["qrcode_img_content"] === "string" ? response["qrcode_img_content"] : null,
      qrToken,
    };
  }

  async getQrStatus(input: { qrToken: string }): Promise<WeChatIlinkQrStatusResponse> {
    const qrToken = input.qrToken.trim();

    if (!isTruthy(qrToken)) {
      throw new WeChatIlinkApiError({
        code: "missing_qrcode",
        endpoint: WECHAT_ILINK_ENDPOINT.getQrStatus,
        message: "WeChat iLink QR status requires qrcode.",
      });
    }

    const endpoint = `${WECHAT_ILINK_ENDPOINT.getQrStatus}?qrcode=${encodeURIComponent(qrToken)}`;
    const response = await this.#get(endpoint, { timeoutMs: 35_000 });
    const status = response["status"];

    if (
      status !== "confirmed" &&
      status !== "expired" &&
      status !== "scaned" &&
      status !== "wait"
    ) {
      throw new WeChatIlinkApiError({
        code: "unsupported_qr_status",
        endpoint: WECHAT_ILINK_ENDPOINT.getQrStatus,
        message: "WeChat iLink QR status response did not include a supported status.",
      });
    }

    const qrStatus: WeChatIlinkQrStatusResponse = { status };

    if (typeof response["baseurl"] === "string") {
      qrStatus.baseurl = response["baseurl"];
    }

    if (typeof response["bot_token"] === "string") {
      qrStatus.bot_token = response["bot_token"];
    }

    if (typeof response["ilink_bot_id"] === "string") {
      qrStatus.ilink_bot_id = response["ilink_bot_id"];
    }

    if (typeof response["ilink_user_id"] === "string") {
      qrStatus.ilink_user_id = response["ilink_user_id"];
    }

    return qrStatus;
  }

  async getUpdates(input: WeChatIlinkGetUpdatesInput): Promise<string> {
    return this.#postRaw(WECHAT_ILINK_ENDPOINT.getUpdates, {
      payload: {
        get_updates_buf: input.cursor,
      },
      timeoutMs: input.timeoutMs,
      token: this.#requireBotToken(WECHAT_ILINK_ENDPOINT.getUpdates),
    });
  }

  async sendText(input: WeChatIlinkSendTextInput): Promise<void> {
    const text = input.text.trim();
    const contextToken = input.contextToken.trim();

    if (!isTruthy(text)) {
      throw new WeChatIlinkApiError({
        code: "empty_text",
        endpoint: WECHAT_ILINK_ENDPOINT.sendMessage,
        message: "WeChat iLink send text requires non-empty text.",
      });
    }

    if (!isTruthy(contextToken)) {
      throw new WeChatIlinkApiError({
        code: "missing_context_token",
        endpoint: WECHAT_ILINK_ENDPOINT.sendMessage,
        message: "WeChat iLink send text requires context_token.",
      });
    }

    const payload: WeChatIlinkSendMessagePayload = {
      msg: {
        client_id: input.clientId,
        context_token: contextToken,
        from_user_id: "",
        item_list: [{ text_item: { text }, type: 1 }],
        message_state: 2,
        message_type: 2,
        to_user_id: input.toUserId,
      },
    };

    const response = await this.#postJson(WECHAT_ILINK_ENDPOINT.sendMessage, {
      payload,
      timeoutMs: 15_000,
      token: this.#requireBotToken(WECHAT_ILINK_ENDPOINT.sendMessage),
    });

    ensureIlinkOk(WECHAT_ILINK_ENDPOINT.sendMessage, response);
  }

  async #get(endpoint: string, input: { timeoutMs: number }): Promise<Record<string, unknown>> {
    const response = await this.#fetch(endpointUrl(this.#baseUrl, endpoint), {
      headers: {
        "iLink-App-ClientVersion": String(WECHAT_ILINK_APP_CLIENT_VERSION),
        "iLink-App-Id": WECHAT_ILINK_APP_ID,
      },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const body = await response.text();

    if (!response.ok) {
      throw new WeChatIlinkHttpError({
        bodyPreview: body.slice(0, 200),
        endpoint,
        status: response.status,
      });
    }

    return parseJsonObject(body, endpoint);
  }

  async #postJson(
    endpoint: string,
    input: { payload: object; timeoutMs: number; token: string },
  ): Promise<Record<string, unknown>> {
    const body = await this.#postRaw(endpoint, input);
    return parseJsonObject(body, endpoint);
  }

  async #postRaw(
    endpoint: string,
    input: { payload: object; timeoutMs: number; token: string },
  ): Promise<string> {
    const body = createRequestBody(input.payload);
    const response = await this.#fetch(endpointUrl(this.#baseUrl, endpoint), {
      body,
      headers: {
        Authorization: `Bearer ${input.token}`,
        AuthorizationType: "ilink_bot_token",
        "Content-Length": String(new TextEncoder().encode(body).byteLength),
        "Content-Type": "application/json",
        "iLink-App-ClientVersion": String(WECHAT_ILINK_APP_CLIENT_VERSION),
        "iLink-App-Id": WECHAT_ILINK_APP_ID,
        "X-WECHAT-UIN": this.#randomUin(),
      },
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const responseBody = await response.text();

    if (!response.ok) {
      throw new WeChatIlinkHttpError({
        bodyPreview: responseBody.slice(0, 200),
        endpoint,
        status: response.status,
      });
    }

    return responseBody;
  }

  #requireBotToken(endpoint: string): string {
    if (!this.#botToken) {
      throw new WeChatIlinkApiError({
        code: "missing_bot_token",
        endpoint,
        message: "WeChat iLink bot token is required.",
      });
    }

    return this.#botToken;
  }
}
