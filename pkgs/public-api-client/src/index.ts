import {
  PUBLIC_THREAD_EVENTS_MAX_LIMIT,
  PUBLIC_THREAD_RUN_TERMINAL_STATUSES,
} from "@mosoo/contracts/public-api";
import type {
  PublicApiErrorCode,
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiListThreadEventsResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
  PublicThreadEventLogEntry,
  PublicThreadFinalOutput,
  PublicThreadRunStatus,
  PublicThreadRunSummary,
  PublicThreadRunTerminalStatus,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";

type FetchFunction = typeof fetch;

interface CreateThreadRequestBody {
  client_external_ref?: string;
  files?: { file_id: string }[];
  input?: {
    content: { text: string; type: "text" }[];
    type: "user.message";
  };
}

interface SseMessage {
  data: string;
  event: string;
  id: string | null;
}

export interface MosooPublicThreadClientOptions {
  allowBrowserToken?: boolean;
  baseUrl: string;
  fetch?: FetchFunction;
  pollIntervalMs?: number;
  token: string;
}

export interface MosooCreateThreadInput {
  agentId: string;
  clientExternalRef?: string;
  fileIds?: string[];
  idempotencyKey?: string;
  input?: string;
  signal?: AbortSignal | undefined;
}

export interface MosooSendEventsInput {
  events: PublicThreadApiSendEventsRequest["events"];
  idempotencyKey?: string;
  signal?: AbortSignal | undefined;
  threadId: string;
}

export interface MosooListEventsInput {
  limit?: number;
  signal?: AbortSignal | undefined;
  threadId: string;
}

export interface MosooStreamEventsInput extends MosooListEventsInput {}

export interface MosooWaitForRunInput {
  eventLimit?: number;
  pollIntervalMs?: number;
  runId?: string;
  signal?: AbortSignal | undefined;
  threadId: string;
  timeoutMs?: number;
}

export interface MosooCreateThreadAndWaitInput extends MosooCreateThreadInput {
  eventLimit?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface MosooPublicThreadWaitResult {
  events: PublicThreadEventLogEntry[];
  finalOutput: PublicThreadFinalOutput | null;
  run: PublicThreadRunSummary;
  thread: PublicThreadSummary;
  truncated: boolean;
}

export interface ExtractFinalOutputOptions {
  runId?: string;
}

export interface MosooPublicApiErrorInput {
  body: unknown;
  code: PublicApiErrorCode | string | null;
  message: string;
  status: number;
}

export class MosooPublicApiError extends Error {
  readonly body: unknown;
  readonly code: PublicApiErrorCode | string | null;
  readonly status: number;

  constructor(input: MosooPublicApiErrorInput) {
    super(input.message);
    this.name = "MosooPublicApiError";
    this.body = input.body;
    this.code = input.code;
    this.status = input.status;
  }
}

export class MosooPublicApiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out waiting for Public Thread run after ${timeoutMs} ms.`);
    this.name = "MosooPublicApiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

const TERMINAL_STATUS_SET: ReadonlySet<PublicThreadRunStatus> = new Set<PublicThreadRunStatus>(
  PUBLIC_THREAD_RUN_TERMINAL_STATUSES,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePublicApiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname;
  } else if (pathname.endsWith("/api")) {
    url.pathname = `${pathname}/v1`;
  } else {
    url.pathname = `${pathname}/api/v1`;
  }

  url.hash = "";
  url.search = "";

  return url.toString().replace(/\/$/, "");
}

function isBrowserLikeRuntime(): boolean {
  return typeof window === "object" && typeof document === "object";
}

function createCreateThreadBody(input: MosooCreateThreadInput): CreateThreadRequestBody {
  const body: CreateThreadRequestBody = {};

  if (input.clientExternalRef !== undefined) {
    body.client_external_ref = input.clientExternalRef;
  }

  if (input.fileIds !== undefined && input.fileIds.length > 0) {
    body.files = input.fileIds.map((fileId) => ({ file_id: fileId }));
  }

  if (input.input !== undefined) {
    body.input = {
      content: [{ text: input.input, type: "text" }],
      type: "user.message",
    };
  }

  return body;
}

function appendQuery(url: URL, key: string, value: string | number | undefined): void {
  if (value !== undefined) {
    url.searchParams.set(key, String(value));
  }
}

function readErrorPayload(body: unknown): {
  code: PublicApiErrorCode | string | null;
  message: string | null;
} {
  if (!isRecord(body)) {
    return { code: null, message: null };
  }

  const error = body["error"];

  if (!isRecord(error)) {
    return { code: null, message: null };
  }

  const code = error["code"];
  const message = error["message"];

  return {
    code: typeof code === "string" ? code : null,
    message: typeof message === "string" ? message : null,
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  } catch {
    return null;
  }
}

function parseSseFieldValue(line: string): string {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex < 0) {
    return "";
  }

  const value = line.slice(separatorIndex + 1);

  return value.startsWith(" ") ? value.slice(1) : value;
}

function parseSseMessage(block: string): SseMessage | null {
  if (block.trim().length === 0) {
    return null;
  }

  const dataLines: string[] = [];
  let event = "message";
  let id: string | null = null;

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = parseSseFieldValue(line);
      continue;
    }

    if (line.startsWith("id:")) {
      id = parseSseFieldValue(line);
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(parseSseFieldValue(line));
    }
  }

  return {
    data: dataLines.join("\n"),
    event,
    id,
  };
}

function isPublicThreadEventLogEntry(value: unknown): value is PublicThreadEventLogEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["content"] === "string" &&
    typeof value["id"] === "string" &&
    typeof value["occurredAt"] === "string" &&
    (typeof value["runId"] === "string" || value["runId"] === null) &&
    typeof value["status"] === "string" &&
    typeof value["type"] === "string"
  );
}

function createSsePublicApiError(body: unknown): MosooPublicApiError {
  const payload = readErrorPayload(body);

  return new MosooPublicApiError({
    body,
    code: payload.code,
    message: payload.message ?? "Public Thread event stream failed.",
    status: 0,
  });
}

function parseThreadEventMessage(message: SseMessage): PublicThreadEventLogEntry | null {
  if (message.event !== "thread.event" || message.data.length === 0) {
    return null;
  }

  const parsed: unknown = JSON.parse(message.data);

  if (!isPublicThreadEventLogEntry(parsed)) {
    throw new Error("Public Thread event stream returned an invalid thread.event payload.");
  }

  return parsed;
}

function parseThreadErrorMessage(message: SseMessage): MosooPublicApiError | null {
  if (message.event !== "thread.error" || message.data.length === 0) {
    return null;
  }

  return createSsePublicApiError(JSON.parse(message.data));
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(new Error("Operation aborted."));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Operation aborted."));
      },
      { once: true },
    );
  });
}

export function isPublicThreadRunTerminalStatus(
  status: PublicThreadRunStatus,
): status is PublicThreadRunTerminalStatus {
  return TERMINAL_STATUS_SET.has(status);
}

export function extractFinalOutput(
  events: readonly PublicThreadEventLogEntry[],
  options: ExtractFinalOutputOptions = {},
): PublicThreadFinalOutput {
  const text = events
    .filter((event) => {
      if (event.type !== "agent.message.delta" || event.status !== "available") {
        return false;
      }

      return options.runId === undefined || event.runId === options.runId;
    })
    .map((event) => event.content)
    .join("");

  return { text };
}

export class MosooPublicThreadClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchFunction;
  private readonly pollIntervalMs: number;
  private readonly token: string;

  constructor(options: MosooPublicThreadClientOptions) {
    if (options.allowBrowserToken !== true && isBrowserLikeRuntime()) {
      throw new Error(
        "MosooPublicThreadClient sends MOSOO_API_TOKEN credentials and must run on a backend, Worker, or Node-like runtime.",
      );
    }

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== "function") {
      throw new Error("MosooPublicThreadClient requires a fetch implementation.");
    }

    this.apiBaseUrl = normalizePublicApiBaseUrl(options.baseUrl);
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.token = options.token;
  }

  async createThread(input: MosooCreateThreadInput): Promise<PublicThreadApiCreateThreadResponse> {
    return this.requestJson("POST", `/agents/${input.agentId}/threads`, {
      body: createCreateThreadBody(input),
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
      status: 201,
    });
  }

  async retrieveThread(
    threadId: string,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<PublicThreadApiRetrieveThreadResponse> {
    return this.requestJson("GET", `/threads/${threadId}`, {
      signal: options.signal,
      status: 200,
    });
  }

  async sendEvents(input: MosooSendEventsInput): Promise<PublicThreadApiSendEventsResponse> {
    return this.requestJson("POST", `/threads/${input.threadId}/events`, {
      body: { events: input.events },
      idempotencyKey: input.idempotencyKey,
      signal: input.signal,
      status: 200,
    });
  }

  async listEvents(input: MosooListEventsInput): Promise<PublicThreadApiListThreadEventsResponse> {
    const url = this.url(`/threads/${input.threadId}/events`);
    appendQuery(url, "limit", input.limit);

    return this.requestJsonUrl("GET", url, {
      signal: input.signal,
      status: 200,
    });
  }

  async *streamEvents(input: MosooStreamEventsInput): AsyncGenerator<PublicThreadEventLogEntry> {
    const url = this.url(`/threads/${input.threadId}/events/stream`);
    appendQuery(url, "limit", input.limit);

    const response = await this.requestResponseUrl("GET", url, {
      accept: "text/event-stream",
      signal: input.signal,
    });
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Public Thread event stream response did not include a readable body.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const chunk = await reader.read();

      if (chunk.done) {
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(chunk.value, { stream: true });
      }

      for (;;) {
        const separator = /\r?\n\r?\n/.exec(buffer);

        if (separator === null) {
          break;
        }

        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const message = parseSseMessage(block);

        if (message === null) {
          continue;
        }

        const error = parseThreadErrorMessage(message);

        if (error !== null) {
          throw error;
        }

        const event = parseThreadEventMessage(message);

        if (event !== null) {
          yield event;
        }
      }

      if (chunk.done) {
        break;
      }
    }
  }

  async waitForRun(input: MosooWaitForRunInput): Promise<MosooPublicThreadWaitResult> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const startedAt = Date.now();

    for (;;) {
      const retrieved = await this.retrieveThread(input.threadId, { signal: input.signal });
      const run = retrieved.run;

      if (run === null) {
        throw new Error("Thread does not have a current Run.");
      }

      if (input.runId !== undefined && run.id !== input.runId) {
        throw new Error(`Thread current Run is ${run.id}, not requested Run ${input.runId}.`);
      }

      if (isPublicThreadRunTerminalStatus(run.status)) {
        const eventPage = await this.listEvents({
          limit: input.eventLimit ?? PUBLIC_THREAD_EVENTS_MAX_LIMIT,
          signal: input.signal,
          threadId: input.threadId,
        });
        const finalOutput =
          run.finalOutput ??
          (run.status === "completed"
            ? extractFinalOutput(eventPage.events, { runId: run.id })
            : null);
        const terminalRun: PublicThreadRunSummary = {
          ...run,
          finalOutput,
        };

        return {
          events: eventPage.events,
          finalOutput,
          run: terminalRun,
          thread: retrieved.thread,
          truncated: eventPage.truncated,
        };
      }

      const elapsedMs = Date.now() - startedAt;

      if (elapsedMs >= timeoutMs) {
        throw new MosooPublicApiTimeoutError(timeoutMs);
      }

      await delay(
        Math.min(input.pollIntervalMs ?? this.pollIntervalMs, timeoutMs - elapsedMs),
        input.signal,
      );
    }
  }

  async waitForCompletion(input: MosooWaitForRunInput): Promise<MosooPublicThreadWaitResult> {
    return this.waitForRun(input);
  }

  extractFinalOutput(
    events: readonly PublicThreadEventLogEntry[],
    options: ExtractFinalOutputOptions = {},
  ): PublicThreadFinalOutput {
    return extractFinalOutput(events, options);
  }

  async createThreadAndWait(
    input: MosooCreateThreadAndWaitInput,
  ): Promise<MosooPublicThreadWaitResult> {
    const created = await this.createThread(input);

    if (created.run === null) {
      throw new Error("createThreadAndWait requires input that starts a Run.");
    }

    const waitInput: MosooWaitForRunInput = {
      runId: created.run.id,
      threadId: created.thread.id,
    };

    if (input.eventLimit !== undefined) {
      waitInput.eventLimit = input.eventLimit;
    }

    if (input.pollIntervalMs !== undefined) {
      waitInput.pollIntervalMs = input.pollIntervalMs;
    }

    if (input.signal !== undefined) {
      waitInput.signal = input.signal;
    }

    if (input.timeoutMs !== undefined) {
      waitInput.timeoutMs = input.timeoutMs;
    }

    return this.waitForRun(waitInput);
  }

  private url(path: string): URL {
    return new URL(`${this.apiBaseUrl}${path}`);
  }

  private async requestJson<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string | undefined;
      signal?: AbortSignal | undefined;
      status: number;
    },
  ): Promise<T> {
    return this.requestJsonUrl(method, this.url(path), options);
  }

  private async requestJsonUrl<T>(
    method: string,
    url: URL,
    options: {
      body?: unknown;
      idempotencyKey?: string | undefined;
      signal?: AbortSignal | undefined;
      status: number;
    },
  ): Promise<T> {
    const response = await this.requestResponseUrl(method, url, {
      body: options.body,
      idempotencyKey: options.idempotencyKey,
      signal: options.signal,
    });

    if (response.status !== options.status) {
      await this.throwPublicApiError(response);
    }

    return (await response.json()) as T;
  }

  private async requestResponseUrl(
    method: string,
    url: URL,
    options: {
      accept?: string | undefined;
      body?: unknown;
      idempotencyKey?: string | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<Response> {
    const headers = new Headers();
    headers.set("Accept", options.accept ?? "application/json");
    headers.set("Authorization", `Bearer ${this.token}`);

    const init: RequestInit = {
      headers,
      method,
    };

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(options.body);
    }

    if (options.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }

    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      await this.throwPublicApiError(response);
    }

    return response;
  }

  private async throwPublicApiError(response: Response): Promise<never> {
    const body = await readResponseBody(response);
    const payload = readErrorPayload(body);

    throw new MosooPublicApiError({
      body,
      code: payload.code,
      message: payload.message ?? `Mosoo Public API request failed with HTTP ${response.status}.`,
      status: response.status,
    });
  }
}
