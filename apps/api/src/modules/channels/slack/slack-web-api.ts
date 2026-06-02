import { fetchChannelWebApi, readChannelWebApiJson } from "../channel-fetch";

export interface SlackPostMessageInput {
  channelId: string;
  text: string;
  threadTs: string;
}

export interface SlackUpdateMessageInput {
  channelId: string;
  text: string;
  ts: string;
}

export interface SlackMessageReference {
  channelId: string;
  ts: string;
}

interface SlackWebApiOkResponse {
  channel?: string;
  ok: true;
  ts?: string;
}

interface SlackWebApiErrorResponse {
  error?: string;
  ok: false;
}

type SlackWebApiResponse = SlackWebApiErrorResponse | SlackWebApiOkResponse;

type SlackWebApiOperation = "auth.test" | "chat.postMessage" | "chat.update";

export class SlackWebApiError extends Error {
  readonly code: string;
  readonly operation: SlackWebApiOperation;

  constructor(operation: SlackWebApiOperation, code: string) {
    super(`Slack ${operation} failed: ${code}`);
    this.code = code;
    this.name = "SlackWebApiError";
    this.operation = operation;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSlackWebApiResponse(value: unknown): value is SlackWebApiResponse {
  if (!isJsonObject(value)) {
    return false;
  }

  const ok = value["ok"];

  return ok === true || ok === false;
}

function readNonEmptyString(value: unknown, key: string): string | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function getSlackErrorCode(
  response: Response,
  body: unknown,
  operation: SlackWebApiOperation,
): string {
  if (isSlackWebApiResponse(body) && !body.ok && typeof body.error === "string") {
    return body.error;
  }

  return response.statusText.trim() || `${operation}_failed`;
}

export class SlackWebApiClient {
  readonly #botToken: string;
  readonly #timeoutMs: number | undefined;

  constructor(botToken: string, options: { timeoutMs?: number } = {}) {
    this.#botToken = botToken;
    this.#timeoutMs = options.timeoutMs;
  }

  async authTest(): Promise<{
    botId: string | null;
    team: string | null;
    teamId: string | null;
    user: string | null;
    userId: string | null;
  }> {
    const response = await fetchChannelWebApi({
      init: {
        headers: {
          Authorization: `Bearer ${this.#botToken}`,
        },
        method: "POST",
      },
      label: "Slack auth.test",
      timeoutMs: this.#timeoutMs,
      url: "https://slack.com/api/auth.test",
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok || !isSlackWebApiResponse(body) || !body.ok) {
      throw new SlackWebApiError("auth.test", getSlackErrorCode(response, body, "auth.test"));
    }

    return {
      botId: readNonEmptyString(body, "bot_id"),
      team: readNonEmptyString(body, "team"),
      teamId: readNonEmptyString(body, "team_id"),
      user: readNonEmptyString(body, "user"),
      userId: readNonEmptyString(body, "user_id"),
    };
  }

  async postChatMessage(input: SlackPostMessageInput): Promise<SlackMessageReference> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          channel: input.channelId,
          text: input.text,
          thread_ts: input.threadTs,
          unfurl_links: false,
          unfurl_media: false,
        }),
        headers: {
          Authorization: `Bearer ${this.#botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Slack chat.postMessage",
      timeoutMs: this.#timeoutMs,
      url: "https://slack.com/api/chat.postMessage",
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok || !isSlackWebApiResponse(body) || !body.ok) {
      throw new SlackWebApiError(
        "chat.postMessage",
        getSlackErrorCode(response, body, "chat.postMessage"),
      );
    }

    if (typeof body.ts !== "string" || !body.ts.trim()) {
      throw new Error("Slack chat.postMessage response did not include a message timestamp.");
    }

    return {
      channelId:
        typeof body.channel === "string" && body.channel.trim() ? body.channel : input.channelId,
      ts: body.ts,
    };
  }

  async updateMessage(input: SlackUpdateMessageInput): Promise<void> {
    const response = await fetchChannelWebApi({
      init: {
        body: JSON.stringify({
          channel: input.channelId,
          text: input.text,
          ts: input.ts,
          unfurl_links: false,
          unfurl_media: false,
        }),
        headers: {
          Authorization: `Bearer ${this.#botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        method: "POST",
      },
      label: "Slack chat.update",
      timeoutMs: this.#timeoutMs,
      url: "https://slack.com/api/chat.update",
    });
    const body = await readChannelWebApiJson(response);

    if (!response.ok || !isSlackWebApiResponse(body) || !body.ok) {
      throw new SlackWebApiError("chat.update", getSlackErrorCode(response, body, "chat.update"));
    }
  }
}
