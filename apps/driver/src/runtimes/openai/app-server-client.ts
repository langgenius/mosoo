import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline";

import type { DriverBootPayload } from "@mosoo/driver-protocol";
import { createPromiseDeferred } from "@mosoo/effects";

import { toDriverDurationMs } from "../../core/driver-runtime-timing";
import type { AgentDriverContext } from "../agent-driver-backend";
import { buildRuntimeChildProcessEnv } from "../child-process-env";
import { summarizeOpenAiProxyEnv } from "./app-server-env";
import {
  isRecord,
  readNonEmptyString,
  readRecord,
  readString,
  stringifyForDisplay,
  toJsonRpcId,
} from "./app-server-json";
import type { JsonObject } from "./app-server-json";
import {
  materializeOpenAiApiKeyAuthState,
  materializeOpenAiModelProviderConfig,
} from "./auth-state";
import type {
  ClientRequestMethod,
  ClientRequestParams,
  ClientRequestResult,
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalResponse,
  PermissionsRequestApprovalResponse,
  RequestId,
  ServerNotificationMethod,
  ServerNotificationParams,
  ServerRequestMethod,
} from "./generated/app-server-protocol";
import {
  CLIENT_REQUEST_RESULT_PARSERS,
  isServerNotificationMethod,
  isServerRequestMethod,
  parseServerNotificationParams,
} from "./generated/app-server-protocol";

interface PendingJsonRpcRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
}

export interface OpenAiAppServerClientStartPhase {
  readonly durationMs: number;
  readonly name: string;
}

export interface OpenAiAppServerClientStartResult {
  readonly phases: readonly OpenAiAppServerClientStartPhase[];
}

interface OpenAiClientContext extends AgentDriverContext {
  handleNotification<M extends ServerNotificationMethod>(
    method: M,
    params: ServerNotificationParams[M],
  ): Promise<void>;
  handleProtocolError(error: Error): Promise<void>;
}

function toOpenAiApprovalDecision(
  decision: "allow_once" | "reject_once",
): CommandExecutionRequestApprovalResponse["decision"] {
  return decision === "allow_once" ? "accept" : "decline";
}

function toPermissionProfileGrant(params: JsonObject): PermissionsRequestApprovalResponse {
  const permissions = readRecord(params, "permissions");

  if (permissions === null) {
    return {
      permissions: {},
      scope: "turn",
    };
  }

  return {
    permissions: { ...permissions },
    scope: "turn",
  };
}

const OPENAI_RUNTIME_HOME_ENV_NAME = ["CODE", "X_HOME"].join("");
const DEFAULT_OPENAI_RUNTIME_EXECUTABLE = ["co", "dex"].join("");

export class OpenAiAppServerClient {
  readonly #context: OpenAiClientContext;
  readonly #pendingRequests = new Map<RequestId, PendingJsonRpcRequest>();
  readonly #payload: DriverBootPayload;
  #nextId = 1;
  #process: ChildProcessWithoutNullStreams | null = null;
  #readline: ReadlineInterface | null = null;
  #serverMessageQueue: Promise<void> = Promise.resolve();

  constructor(payload: DriverBootPayload, context: OpenAiClientContext) {
    this.#payload = payload;
    this.#context = context;
  }

  async start(): Promise<OpenAiAppServerClientStartResult> {
    const phases: OpenAiAppServerClientStartPhase[] = [];
    const measure = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
      const startedAtMs = Date.now();

      try {
        return await task();
      } finally {
        phases.push({
          durationMs: toDriverDurationMs(startedAtMs),
          name,
        });
      }
    };
    const { homePath } = this.#payload.execution.session.context;
    const runtimeHome = homePath;
    await measure("app_server.home.mkdir", () => mkdir(runtimeHome, { recursive: true }));

    const env = buildRuntimeChildProcessEnv({
      ...this.#payload.execution.environment.variables,
      [OPENAI_RUNTIME_HOME_ENV_NAME]: runtimeHome,
      LOG_FORMAT: "json",
    });
    const authState = await measure("app_server.auth_state", () =>
      materializeOpenAiApiKeyAuthState({
        runtimeHome,
        env,
      }),
    );
    const modelProviderConfig = await measure("app_server.config", () =>
      materializeOpenAiModelProviderConfig({
        env,
        provider: this.#payload.execution.provider,
        runtimeHome,
      }),
    );

    this.#context.logger.debug("driver.openai.auth_state.prepared", {
      authJsonWritten: authState.written,
      hasApiKey: authState.hasApiKey,
    });
    this.#context.logger.debug("driver.openai.model_provider_config.prepared", {
      configTomlWritten: modelProviderConfig.written,
      provider: modelProviderConfig.provider,
    });
    this.#context.logger.debug("driver.openai.env.prepared", {
      proxyEnv: summarizeOpenAiProxyEnv(env),
    });

    await measure("app_server.spawn", async () => {
      const executable =
        process.env["MOSOO_OPENAI_RUNTIME_EXECUTABLE"] ?? DEFAULT_OPENAI_RUNTIME_EXECUTABLE;
      const child = spawn(executable, ["app-server"], {
        cwd: this.#payload.execution.session.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.#process = child;
      this.#readline = createInterface({ input: child.stdout });

      this.#readline.on("line", (line) => {
        this.#handleLine(line);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.#context.logger.debug("driver.openai.stderr", {
          chunk,
        });
      });
      child.once("exit", (code, signal) => {
        const message = `OpenAi app-server exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}.`;
        this.#rejectPending(new Error(message));
      });
    });

    await measure("app_server.initialize", async () => {
      await this.request("initialize", {
        capabilities: {
          experimentalApi: true,
        },
        clientInfo: {
          name: "mosoo_driver",
          title: "Mosoo Driver",
          version: "0.1.0",
        },
      });
      this.notify("initialized", {});
    });

    return { phases };
  }

  async request<M extends ClientRequestMethod>(
    method: M,
    params: ClientRequestParams[M],
  ): Promise<ClientRequestResult[M]> {
    const id = this.#nextId;
    this.#nextId += 1;

    const response = createPromiseDeferred<ClientRequestResult[M]>();
    const parseResult = CLIENT_REQUEST_RESULT_PARSERS[method];
    this.#pendingRequests.set(id, {
      reject: response.reject,
      resolve: (value) => {
        response.resolve(parseResult(value));
      },
    });

    this.#send({
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });

    return response.promise;
  }

  notify(method: string, params: JsonObject | undefined): void {
    this.#send({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  respond(id: RequestId, result: unknown): void {
    this.#send({
      id,
      result,
    });
  }

  respondError(id: RequestId, message: string): void {
    this.#send({
      error: {
        code: -32_000,
        message,
      },
      id,
    });
  }

  stop(): void {
    this.#readline?.close();
    this.#readline = null;
    this.#process?.kill("SIGTERM");
    this.#process = null;
    this.#rejectPending(new Error("OpenAi app-server stopped."));
  }

  #send(message: Record<string, unknown>): void {
    const child = this.#process;

    if (child === null || child.stdin.destroyed) {
      throw new Error("OpenAi app-server is not running.");
    }

    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.#context.logger.debug("driver.openai.non_json_stdout", {
        line: trimmed,
      });
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    const method = readNonEmptyString(parsed, "method");
    const id = toJsonRpcId(parsed["id"]);

    if (method !== null) {
      this.#serverMessageQueue = this.#handleQueuedServerMessage(
        this.#serverMessageQueue,
        method,
        id,
        parsed["params"],
      );
      return;
    }

    if (id !== null) {
      this.#handleClientResponse(id, parsed);
    }
  }

  async #handleQueuedServerMessage(
    previousMessage: Promise<void>,
    method: string,
    id: RequestId | null,
    params: unknown,
  ): Promise<void> {
    try {
      await previousMessage;
      await this.#handleServerMessage(method, id, params);
    } catch (error) {
      this.#context.logger.error("driver.openai.server_message.failed", error, {
        method,
      });
      await this.#context.handleProtocolError(
        error instanceof Error ? error : new Error("OpenAi app-server protocol message failed."),
      );

      if (id !== null) {
        this.respondError(id, error instanceof Error ? error.message : "Server request failed.");
      }
    }
  }

  #handleClientResponse(id: RequestId, message: JsonObject): void {
    const pending = this.#pendingRequests.get(id);

    if (pending === undefined) {
      return;
    }

    this.#pendingRequests.delete(id);

    const responseError = readRecord(message, "error");

    if (responseError !== null) {
      pending.reject(
        new Error(readString(responseError, "message") ?? "OpenAi app-server request failed."),
      );
      return;
    }

    try {
      pending.resolve(message["result"]);
    } catch (parseError) {
      pending.reject(
        parseError instanceof Error
          ? parseError
          : new Error("OpenAi app-server result parse failed."),
      );
    }
  }

  async #handleServerMessage(method: string, id: RequestId | null, params: unknown): Promise<void> {
    if (id === null) {
      if (!isServerNotificationMethod(method)) {
        this.#context.logger.debug("driver.openai.server_notification.ignored", {
          method,
        });
        return;
      }

      await this.#context.handleNotification(method, parseServerNotificationParams(method, params));
      return;
    }

    if (!isServerRequestMethod(method)) {
      this.respondError(id, `Unsupported OpenAi app-server request: ${method}.`);
      return;
    }

    await this.#handleServerRequest(method, id, params);
  }

  async #handleServerRequest(
    method: ServerRequestMethod,
    id: RequestId,
    params: unknown,
  ): Promise<void> {
    const payload = isRecord(params) ? params : {};
    const requestId = `${method}:${String(id)}`;

    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      const decision = await this.#context.permissions.request({
        rawInput: stringifyForDisplay(payload["command"] ?? payload["reason"] ?? payload),
        requestId,
        title:
          method === "item/fileChange/requestApproval"
            ? "Approve file changes"
            : "Approve command execution",
        toolCallId: readString(payload, "itemId"),
        toolKind: method,
      });
      const response: CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse =
        {
          decision: toOpenAiApprovalDecision(decision),
        };
      this.respond(id, response);
      return;
    }

    if (method === "item/permissions/requestApproval") {
      const decision = await this.#context.permissions.request({
        rawInput: stringifyForDisplay(payload["permissions"] ?? payload),
        requestId,
        title: "Approve runtime permissions",
        toolCallId: readString(payload, "itemId"),
        toolKind: method,
      });
      this.respond(
        id,
        decision === "allow_once"
          ? toPermissionProfileGrant(payload)
          : {
              permissions: {},
              scope: "turn",
            },
      );
      return;
    }

    this.respondError(id, "Unsupported OpenAi app-server request.");
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      pending.reject(error);
    }

    this.#pendingRequests.clear();
  }
}
