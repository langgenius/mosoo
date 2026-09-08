import { PUBLIC_THREAD_RUN_TERMINAL_STATUSES } from "./types.ts";
import type {
  PublicApiErrorCode,
  PublicFileResponse,
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiListThreadEventsResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
  PublicThreadEventLogEntry,
  PublicThreadFinalOutput,
  PublicThreadFileListResponse,
  PublicThreadRunStatus,
  PublicThreadRunSummary,
  PublicThreadRunTerminalStatus,
  PublicThreadSummary,
} from "./types.ts";

export type * from "./types.ts";
export * from "./delegation.ts";

export type MosooPublicApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const MOSOO_CLOUD_BASE_URL = "https://cloud.mosoo.ai";

interface CreateThreadRequestBody {
  input?: {
    content: { text: string; type: "text" }[];
    type: "user.message";
  };
  resources?: { file_id: string; type: "file" }[];
  userId: string;
}

interface SseMessage {
  data: string;
  event: string;
  id: string | null;
}

export interface MosooPublicThreadClientOptions {
  allowBrowserToken?: boolean;
  baseUrl?: string;
  fetch?: MosooPublicApiFetch;
  pollIntervalMs?: number;
  token: string;
}

export interface MosooCreateThreadInput {
  agentId: string;
  fileIds?: string[];
  idempotencyKey?: string;
  input?: string;
  signal?: AbortSignal | undefined;
  userId: string;
}

export interface MosooUploadAgentFileInput {
  agentId: string;
  file: Blob;
  filename?: string | undefined;
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

export interface MosooListFilesInput {
  signal?: AbortSignal | undefined;
  threadId: string;
}

export interface MosooStreamEventsInput extends MosooListEventsInput {}

export interface MosooWaitForRunInput {
  pollIntervalMs?: number;
  runId?: string;
  signal?: AbortSignal | undefined;
  threadId: string;
  timeoutMs?: number;
}

export interface MosooCreateThreadAndWaitInput extends MosooCreateThreadInput {
  pollIntervalMs?: number;
  timeoutMs?: number;
  throwOnFailedRun?: boolean;
}

export interface MosooPublicThreadWaitResult {
  finalOutput: PublicThreadFinalOutput | null;
  run: PublicThreadRunSummary;
  thread: PublicThreadSummary;
}

export interface MosooCreateThreadAndWaitFinalOutputInput extends MosooCreateThreadAndWaitInput {
  throwOnFailedRun?: true;
}

export interface MosooCreateThreadAndWaitTerminalInput extends MosooCreateThreadAndWaitInput {
  throwOnFailedRun: false;
}

export type MosooPublicThreadUnsuccessfulTerminalStatus = Exclude<
  PublicThreadRunTerminalStatus,
  "completed"
>;

export interface MosooPublicThreadCompletedRunSummary extends PublicThreadRunSummary {
  finalOutput: PublicThreadFinalOutput;
  status: "completed";
}

export interface MosooPublicThreadUnsuccessfulRunSummary extends PublicThreadRunSummary {
  status: MosooPublicThreadUnsuccessfulTerminalStatus;
}

export interface MosooPublicThreadFinalOutputResult {
  finalOutput: PublicThreadFinalOutput;
  run: MosooPublicThreadCompletedRunSummary;
  thread: PublicThreadSummary;
}

export interface MosooPublicThreadTerminalRunErrorInput {
  finalOutput: PublicThreadFinalOutput | null;
  run: MosooPublicThreadUnsuccessfulRunSummary;
  thread: PublicThreadSummary;
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

export class MosooPublicApiAbortError extends Error {
  readonly code = "aborted";

  constructor() {
    super("Operation aborted.");
    this.name = "MosooPublicApiAbortError";
  }
}

export class MosooPublicThreadRunMismatchError extends Error {
  readonly actualRunId: string;
  readonly code = "run_mismatch";
  readonly expectedRunId: string;

  constructor(expectedRunId: string, actualRunId: string) {
    super(`Thread current Run is ${actualRunId}, not requested Run ${expectedRunId}.`);
    this.name = "MosooPublicThreadRunMismatchError";
    this.actualRunId = actualRunId;
    this.expectedRunId = expectedRunId;
  }
}

export class MosooPublicThreadTerminalRunError extends Error {
  readonly code = "run_terminal_failure";
  readonly finalOutput: PublicThreadFinalOutput | null;
  readonly run: MosooPublicThreadUnsuccessfulRunSummary;
  readonly runStatus: MosooPublicThreadUnsuccessfulTerminalStatus;
  readonly thread: PublicThreadSummary;

  constructor(input: MosooPublicThreadTerminalRunErrorInput) {
    super(`Public Thread run ${input.run.id} finished with status ${input.run.status}.`);
    this.name = "MosooPublicThreadTerminalRunError";
    this.finalOutput = input.finalOutput;
    this.run = input.run;
    this.runStatus = input.run.status;
    this.thread = input.thread;
  }
}

const TERMINAL_STATUS_SET: ReadonlySet<PublicThreadRunStatus> = new Set<PublicThreadRunStatus>(
  PUBLIC_THREAD_RUN_TERMINAL_STATUSES,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePublicApiBaseUrl(baseUrl: string): string {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("Mosoo baseUrl must be a valid absolute URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Mosoo baseUrl must not include credentials, query, or fragment.");
  }

  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new TypeError("Mosoo baseUrl must use HTTPS, except for HTTP loopback development.");
  }

  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname;
  } else if (pathname.endsWith("/api")) {
    url.pathname = `${pathname}/v1`;
  } else {
    url.pathname = `${pathname}/api/v1`;
  }

  return url.toString().replace(/\/$/, "");
}

function encodePathSegment(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty.`);
  }

  return encodeURIComponent(value);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function isBrowserLikeRuntime(): boolean {
  return typeof window === "object" && typeof document === "object";
}

function createCreateThreadBody(input: MosooCreateThreadInput): CreateThreadRequestBody {
  const body: CreateThreadRequestBody = { userId: input.userId };

  if (input.fileIds !== undefined && input.fileIds.length > 0) {
    body.resources = input.fileIds.map((fileId) => ({ file_id: fileId, type: "file" }));
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
    (value["toolCallId"] === undefined || typeof value["toolCallId"] === "string") &&
    (value["toolInput"] === undefined || isRecord(value["toolInput"])) &&
    (value["toolName"] === undefined || typeof value["toolName"] === "string") &&
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
    return Promise.reject(new MosooPublicApiAbortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new MosooPublicApiAbortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isPublicThreadRunTerminalStatus(
  status: PublicThreadRunStatus,
): status is PublicThreadRunTerminalStatus {
  return TERMINAL_STATUS_SET.has(status);
}

function isUnsuccessfulTerminalStatus(
  status: PublicThreadRunStatus,
): status is MosooPublicThreadUnsuccessfulTerminalStatus {
  return isPublicThreadRunTerminalStatus(status) && status !== "completed";
}

function assertFinalOutputResult(
  result: MosooPublicThreadWaitResult,
): MosooPublicThreadFinalOutputResult {
  if (isUnsuccessfulTerminalStatus(result.run.status)) {
    const run: MosooPublicThreadUnsuccessfulRunSummary = {
      ...result.run,
      status: result.run.status,
    };

    throw new MosooPublicThreadTerminalRunError({
      finalOutput: result.finalOutput,
      run,
      thread: result.thread,
    });
  }

  if (result.run.status !== "completed") {
    throw new Error(
      `Public Thread run ${result.run.id} has non-terminal status ${result.run.status}.`,
    );
  }

  if (result.finalOutput === null) {
    throw new Error(`Completed Public Thread run ${result.run.id} did not include final output.`);
  }

  const run: MosooPublicThreadCompletedRunSummary = {
    ...result.run,
    finalOutput: result.finalOutput,
    status: "completed",
  };

  return {
    finalOutput: result.finalOutput,
    run,
    thread: result.thread,
  };
}

/**
 * @deprecated Public event logs can include progress messages and cannot identify
 * the canonical final assistant message. Read `run.finalOutput` instead.
 */
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
  private readonly fetchImpl: MosooPublicApiFetch;
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

    if (options.token.trim().length === 0) {
      throw new TypeError("Mosoo token must not be empty.");
    }

    if (options.pollIntervalMs !== undefined) {
      assertPositiveFinite(options.pollIntervalMs, "pollIntervalMs");
    }

    this.apiBaseUrl = normalizePublicApiBaseUrl(options.baseUrl ?? MOSOO_CLOUD_BASE_URL);

    if (options.fetch === undefined) {
      this.fetchImpl = fetchImpl.bind(globalThis);
    } else {
      const suppliedFetch = options.fetch;
      this.fetchImpl = (input, init) => suppliedFetch(input, init);
    }

    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.token = options.token;
  }

  async createThread(input: MosooCreateThreadInput): Promise<PublicThreadApiCreateThreadResponse> {
    return this.requestJson(
      "POST",
      `/agents/${encodePathSegment(input.agentId, "agentId")}/threads`,
      {
        body: createCreateThreadBody(input),
        idempotencyKey: input.idempotencyKey,
        signal: input.signal,
        status: 201,
      },
    );
  }

  async uploadAgentFile(input: MosooUploadAgentFileInput): Promise<PublicFileResponse> {
    const formData = new FormData();

    if (input.filename === undefined) {
      formData.append("file", input.file);
    } else {
      formData.append("file", input.file, input.filename);
    }

    return this.requestJson(
      "POST",
      `/agents/${encodePathSegment(input.agentId, "agentId")}/files`,
      {
        body: formData,
        signal: input.signal,
        status: 201,
      },
    );
  }

  async retrieveThread(
    threadId: string,
    options: { signal?: AbortSignal | undefined } = {},
  ): Promise<PublicThreadApiRetrieveThreadResponse> {
    return this.requestJson("GET", `/threads/${encodePathSegment(threadId, "threadId")}`, {
      signal: options.signal,
      status: 200,
    });
  }

  async listFiles(input: MosooListFilesInput): Promise<PublicThreadFileListResponse> {
    return this.requestJson(
      "GET",
      `/threads/${encodePathSegment(input.threadId, "threadId")}/files`,
      {
        signal: input.signal,
        status: 200,
      },
    );
  }

  async sendEvents(input: MosooSendEventsInput): Promise<PublicThreadApiSendEventsResponse> {
    return this.requestJson(
      "POST",
      `/threads/${encodePathSegment(input.threadId, "threadId")}/events`,
      {
        body: { events: input.events },
        idempotencyKey: input.idempotencyKey,
        signal: input.signal,
        status: 200,
      },
    );
  }

  async listEvents(input: MosooListEventsInput): Promise<PublicThreadApiListThreadEventsResponse> {
    const url = this.url(`/threads/${encodePathSegment(input.threadId, "threadId")}/events`);
    appendQuery(url, "limit", input.limit);

    return this.requestJsonUrl("GET", url, {
      signal: input.signal,
      status: 200,
    });
  }

  async *streamEvents(input: MosooStreamEventsInput): AsyncGenerator<PublicThreadEventLogEntry> {
    const url = this.url(`/threads/${encodePathSegment(input.threadId, "threadId")}/events/stream`);
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

    try {
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
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async waitForRun(input: MosooWaitForRunInput): Promise<MosooPublicThreadWaitResult> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const pollIntervalMs = input.pollIntervalMs ?? this.pollIntervalMs;
    assertPositiveFinite(timeoutMs, "timeoutMs");
    assertPositiveFinite(pollIntervalMs, "pollIntervalMs");
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    let rejectStopped: (reason: Error) => void = () => {};
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStopped = reject;
    });
    const onAbort = () => {
      controller.abort();
      rejectStopped(new MosooPublicApiAbortError());
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectStopped(new MosooPublicApiTimeoutError(timeoutMs));
    }, timeoutMs);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted === true) {
      onAbort();
    }

    try {
      for (;;) {
        const retrieved = await Promise.race([
          this.retrieveThread(input.threadId, { signal: controller.signal }),
          stopped,
        ]);
        const run = retrieved.run;

        if (run === null) {
          throw new Error("Thread does not have a current Run.");
        }

        if (input.runId !== undefined && run.id !== input.runId) {
          throw new MosooPublicThreadRunMismatchError(input.runId, run.id);
        }

        if (isPublicThreadRunTerminalStatus(run.status)) {
          return {
            finalOutput: run.finalOutput,
            run,
            thread: retrieved.thread,
          };
        }

        const elapsedMs = Date.now() - startedAt;

        if (elapsedMs >= timeoutMs) {
          throw new MosooPublicApiTimeoutError(timeoutMs);
        }

        await delay(Math.min(pollIntervalMs, timeoutMs - elapsedMs), controller.signal);
      }
    } catch (error) {
      if (timedOut) {
        throw new MosooPublicApiTimeoutError(timeoutMs);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      controller.abort();
    }
  }

  async waitForCompletion(input: MosooWaitForRunInput): Promise<MosooPublicThreadWaitResult> {
    return this.waitForRun(input);
  }

  async waitForFinalOutput(
    input: MosooWaitForRunInput,
  ): Promise<MosooPublicThreadFinalOutputResult> {
    return assertFinalOutputResult(await this.waitForRun(input));
  }

  /**
   * @deprecated Public event logs can include progress messages and cannot identify
   * the canonical final assistant message. Read `run.finalOutput` instead.
   */
  extractFinalOutput(
    events: readonly PublicThreadEventLogEntry[],
    options: ExtractFinalOutputOptions = {},
  ): PublicThreadFinalOutput {
    return extractFinalOutput(events, options);
  }

  async createThreadAndWait(
    input: MosooCreateThreadAndWaitTerminalInput,
  ): Promise<MosooPublicThreadWaitResult>;
  async createThreadAndWait(
    input: MosooCreateThreadAndWaitFinalOutputInput,
  ): Promise<MosooPublicThreadFinalOutputResult>;
  async createThreadAndWait(
    input: MosooCreateThreadAndWaitInput,
  ): Promise<MosooPublicThreadWaitResult | MosooPublicThreadFinalOutputResult>;
  async createThreadAndWait(
    input: MosooCreateThreadAndWaitInput,
  ): Promise<MosooPublicThreadWaitResult | MosooPublicThreadFinalOutputResult> {
    const created = await this.createThread(input);

    if (created.run === null) {
      throw new Error("createThreadAndWait requires input that starts a Run.");
    }

    const waitInput: MosooWaitForRunInput = {
      runId: created.run.id,
      threadId: created.thread.id,
    };

    if (input.pollIntervalMs !== undefined) {
      waitInput.pollIntervalMs = input.pollIntervalMs;
    }

    if (input.signal !== undefined) {
      waitInput.signal = input.signal;
    }

    if (input.timeoutMs !== undefined) {
      waitInput.timeoutMs = input.timeoutMs;
    }

    const result = await this.waitForRun(waitInput);

    if (input.throwOnFailedRun === false) {
      return result;
    }

    return assertFinalOutputResult(result);
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
      if (options.body instanceof FormData) {
        init.body = options.body;
      } else {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(options.body);
      }
    }

    if (options.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }

    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    let response: Response;

    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw new MosooPublicApiAbortError();
      }

      throw error;
    }

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

export { MosooPublicThreadClient as Mosoo };
