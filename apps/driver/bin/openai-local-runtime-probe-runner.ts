import type { BunRuntime, BunSubprocess } from "../../../dev/config/bun-script-types";
import { materializeOpenAiApiKeyAuthState } from "../src/runtimes/openai/auth-state";
import {
  RUNTIME_HOME_ENV_NAME,
  isRecord,
  measure,
  parseThread,
  parseTurn,
  readId,
  readObject,
  readString,
  redactSensitiveText,
} from "./openai-local-runtime-probe-types";
import type {
  JsonRpcId,
  JsonRpcObject,
  PhaseRecord,
  RuntimeProbeOptions,
  RuntimeThread,
  RuntimeTurn,
} from "./openai-local-runtime-probe-types";

declare const Bun: BunRuntime;

interface PendingRequest {
  readonly method: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
}

type RuntimeProcess = BunSubprocess;

export class OpenAiLocalRuntimeProbeRunner {
  readonly #options: RuntimeProbeOptions;
  readonly #pendingRequests = new Map<JsonRpcId, PendingRequest>();
  readonly #phases: PhaseRecord[] = [];
  #child: RuntimeProcess | null = null;
  #nextId = 1;
  #stderrTail = "";
  #stdoutLineBuffer = "";
  #terminalTurnResolver: ((turn: RuntimeTurn) => void) | null = null;
  #terminalTurnRejecter: ((error: Error) => void) | null = null;
  readonly #terminalTurns = new Map<string, RuntimeTurn>();

  constructor(options: RuntimeProbeOptions) {
    this.#options = options;
  }

  get phases(): readonly PhaseRecord[] {
    return this.#phases;
  }

  get stderrTail(): string {
    return this.#stderrTail;
  }

  async run(runtimeHome: string): Promise<{
    readonly completedTurn: RuntimeTurn | null;
    readonly thread: RuntimeThread;
    readonly turnStart: RuntimeTurn | null;
  }> {
    await measure(this.#phases, "prepare_auth_state", async () => {
      await materializeOpenAiApiKeyAuthState({
        env: process.env,
        runtimeHome,
      });
    });

    await measure(this.#phases, "spawn_process", async () => {
      await this.#spawn(runtimeHome);
    });

    await measure(this.#phases, "initialize", async () => {
      await this.#request("initialize", {
        capabilities: {
          experimentalApi: true,
        },
        clientInfo: {
          name: "mosoo_local_runtime_probe",
          title: "Mosoo Local Runtime Probe",
          version: "0.1.0",
        },
      });
      this.#notify("initialized", {});
    });

    const thread = await measure(this.#phases, "thread_start", async () =>
      parseThread(
        await this.#request("thread/start", {
          approvalPolicy: "on-request",
          cwd: this.#options.cwd,
          model: this.#options.model,
          modelProvider: "openai",
          sandbox: "danger-full-access",
          sessionStartSource: "startup",
        }),
        "thread/start result",
      ),
    );

    if (this.#options.threadOnly) {
      return {
        completedTurn: null,
        thread,
        turnStart: null,
      };
    }

    const turnStart = await measure(this.#phases, "turn_start", async () =>
      parseTurn(
        await this.#request("turn/start", {
          cwd: this.#options.cwd,
          input: [
            {
              text: this.#options.prompt,
              text_elements: [],
              type: "text",
            },
          ],
          threadId: thread.id,
        }),
        "turn/start result",
      ),
    );

    if (
      turnStart.status === "completed" ||
      turnStart.status === "failed" ||
      turnStart.status === "interrupted"
    ) {
      return {
        completedTurn: turnStart,
        thread,
        turnStart,
      };
    }

    const completedTurn = await measure(this.#phases, "turn_complete", async () =>
      this.#waitForTerminalTurn(turnStart.id),
    );

    return {
      completedTurn,
      thread,
      turnStart,
    };
  }

  stop(): void {
    const child = this.#child;
    this.#child = null;
    if (child !== null && child.exitCode === null) {
      child.kill();
    }
    this.#rejectAll(new Error("Runtime probe stopped."));
  }

  #spawn(runtimeHome: string): Promise<void> {
    const child = Bun.spawn([this.#options.executable, "app-server"], {
      cwd: this.#options.cwd,
      env: {
        ...process.env,
        [RUNTIME_HOME_ENV_NAME]: runtimeHome,
        LOG_FORMAT: "json",
      },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });

    this.#child = child;
    void this.#readStdout(child.stdout).catch((error: unknown) => {
      this.#rejectAll(error instanceof Error ? error : new Error("Runtime stdout read failed."));
    });
    void this.#readStderr(child.stderr).catch((error: unknown) => {
      this.#rejectAll(error instanceof Error ? error : new Error("Runtime stderr read failed."));
    });
    void child.exited.then((code) => {
      this.#rejectAll(new Error(`Runtime app-server exited with code ${code}.`));
    });
    return Promise.resolve();
  }

  #appendStderr(chunk: string): void {
    this.#stderrTail = `${this.#stderrTail}${redactSensitiveText(chunk) ?? ""}`.slice(-8_192);
  }

  async #readStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
    await this.#readTextStream(stream, (chunk) => {
      this.#appendStdout(chunk);
    });

    if (this.#stdoutLineBuffer.length > 0) {
      this.#handleLine(this.#stdoutLineBuffer.replace(/\r$/u, ""));
      this.#stdoutLineBuffer = "";
    }
  }

  async #readStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    await this.#readTextStream(stream, (chunk) => {
      this.#appendStderr(chunk);
    });
  }

  async #readTextStream(
    stream: ReadableStream<Uint8Array>,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      onChunk(decoder.decode(value, { stream: true }));
    }

    const remainder = decoder.decode();
    if (remainder.length > 0) {
      onChunk(remainder);
    }
  }

  #appendStdout(chunk: string): void {
    this.#stdoutLineBuffer += chunk;
    const lines = this.#stdoutLineBuffer.split(/\n/u);
    this.#stdoutLineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      this.#handleLine(line.replace(/\r$/u, ""));
    }
  }

  #notify(method: string, params: JsonRpcObject): void {
    this.#send({
      method,
      params,
    });
  }

  #request(method: string, params: JsonRpcObject): Promise<unknown> {
    const child = this.#child;
    if (child === null) {
      throw new Error("Runtime app-server is not running.");
    }

    const id = this.#nextId;
    this.#nextId += 1;

    const request = new Promise<unknown>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        method,
        reject,
        resolve,
      });
    });

    this.#send({
      id,
      method,
      params,
    });

    return Promise.race([
      request,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          if (this.#pendingRequests.delete(id)) {
            reject(new Error(`${method} timed out after ${this.#options.requestTimeoutMs}ms.`));
          }
        }, this.#options.requestTimeoutMs).unref();
      }),
    ]);
  }

  #send(message: JsonRpcObject): void {
    const child = this.#child;
    if (child === null) {
      throw new Error("Runtime app-server is not running.");
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
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    const id = readId(parsed);
    const method = readString(parsed, "method");

    if (method !== null) {
      this.#handleServerMessage(method, id, parsed["params"]);
      return;
    }

    if (id !== null) {
      this.#handleClientResponse(id, parsed);
    }
  }

  #handleClientResponse(id: JsonRpcId, message: JsonRpcObject): void {
    const pending = this.#pendingRequests.get(id);
    if (pending === undefined) {
      return;
    }
    this.#pendingRequests.delete(id);

    const error = readObject(message, "error");
    if (error !== null) {
      pending.reject(
        new Error(redactSensitiveText(readString(error, "message")) ?? `${pending.method} failed.`),
      );
      return;
    }

    pending.resolve(message["result"]);
  }

  #handleServerMessage(method: string, id: JsonRpcId | null, params: unknown): void {
    if (id !== null) {
      this.#handleServerRequest(method, id);
      return;
    }

    if (method !== "turn/completed") {
      return;
    }

    try {
      const turn = parseTurn({ turn: isRecord(params) ? params["turn"] : null }, method);
      if (this.#terminalTurnResolver === null) {
        this.#terminalTurns.set(turn.id, turn);
      } else {
        this.#terminalTurnResolver(turn);
        this.#terminalTurnResolver = null;
        this.#terminalTurnRejecter = null;
      }
    } catch (error) {
      this.#terminalTurnRejecter?.(
        error instanceof Error ? error : new Error("Terminal turn parse failed."),
      );
      this.#terminalTurnResolver = null;
      this.#terminalTurnRejecter = null;
    }
  }

  #handleServerRequest(method: string, id: JsonRpcId): void {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      this.#send({
        id,
        result: {
          decision: "decline",
        },
      });
      return;
    }

    if (method === "item/permissions/requestApproval") {
      this.#send({
        id,
        result: {
          permissions: {},
          scope: "turn",
        },
      });
      return;
    }

    this.#send({
      error: {
        code: -32_000,
        message: `Unsupported server request ${method}.`,
      },
      id,
    });
  }

  #waitForTerminalTurn(turnId: string): Promise<RuntimeTurn> {
    const completed = this.#terminalTurns.get(turnId);
    if (completed !== undefined) {
      this.#terminalTurns.delete(turnId);
      return Promise.resolve(completed);
    }

    return new Promise<RuntimeTurn>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#terminalTurnResolver = null;
        this.#terminalTurnRejecter = null;
        reject(new Error(`turn/completed timed out for turn ${turnId}.`));
      }, this.#options.requestTimeoutMs).unref();

      this.#terminalTurnResolver = (turn) => {
        clearTimeout(timer);
        if (turn.id !== turnId) {
          reject(new Error(`Received terminal turn ${turn.id}, expected ${turnId}.`));
          return;
        }
        resolve(turn);
      };
      this.#terminalTurnRejecter = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      pending.reject(error);
    }
    this.#pendingRequests.clear();
    this.#terminalTurnRejecter?.(error);
    this.#terminalTurnResolver = null;
    this.#terminalTurnRejecter = null;
  }
}
