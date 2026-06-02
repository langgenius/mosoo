import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { createPromiseDeferred } from "@mosoo/effects";

import type { JsonObject } from "./acp-types";
import { isRecord, readString, toJsonRpcId } from "./acp-types";

export type AcpJsonRpcId = number | string;

export interface AcpJsonRpcRequest {
  readonly id: AcpJsonRpcId;
  readonly method: string;
  readonly params: unknown;
}

export interface AcpJsonRpcNotification {
  readonly method: string;
  readonly params: unknown;
}

export interface AcpJsonRpcConnectionOptions {
  readonly onInvalidMessage: (error: Error, line: string) => void;
  readonly onNotification: (notification: AcpJsonRpcNotification) => Promise<void>;
  readonly onRequest: (request: AcpJsonRpcRequest) => Promise<unknown>;
  readonly onTransportError: (error: Error) => void;
  readonly stdin: Writable;
  readonly stdout: Readable;
}

interface PendingAcpRequest {
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
}

const JSON_RPC_VERSION = "2.0";
const METHOD_NOT_FOUND = -32_601;
const INTERNAL_ERROR = -32_603;

export class AcpJsonRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(input: { code: number; data?: unknown; message: string }) {
    super(input.message);
    this.name = "AcpJsonRpcError";
    this.code = input.code;
    this.data = input.data;
  }
}

export class AcpJsonRpcConnection {
  readonly #interface: Interface;
  #closed = false;
  #nextRequestId = 1;
  readonly #options: AcpJsonRpcConnectionOptions;
  readonly #pending = new Map<AcpJsonRpcId, PendingAcpRequest>();

  constructor(options: AcpJsonRpcConnectionOptions) {
    this.#options = options;
    this.#interface = createInterface({ input: options.stdout });
    this.#interface.on("line", (line) => {
      void this.#handleLine(line).catch((error: unknown) => {
        this.#failTransport(
          error instanceof Error ? error : new Error("ACP JSON-RPC line handler failed."),
        );
      });
    });
    this.#interface.on("close", () => {
      this.#failTransport(new Error("ACP JSON-RPC stream closed."));
    });
    options.stdout.on("error", (error) => {
      this.#failTransport(error instanceof Error ? error : new Error("ACP stdout failed."));
    });
    options.stdin.on("error", (error) => {
      this.#failTransport(error instanceof Error ? error : new Error("ACP stdin failed."));
    });
    options.stdin.on("close", () => {
      this.#failTransport(new Error("ACP stdin closed."));
    });
  }

  close(reason = "ACP JSON-RPC connection closed."): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#interface.close();
    this.#closePending(new Error(reason));
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.#write({
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (this.#closed) {
      throw new Error("ACP JSON-RPC connection is closed.");
    }

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const pending = createPromiseDeferred<unknown>();
    this.#pending.set(id, pending);

    try {
      await this.#write({
        id,
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      });
      return (await pending.promise) as T;
    } catch (error) {
      this.#pending.delete(id);
      throw error;
    }
  }

  async #handleLine(line: string): Promise<void> {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      this.#options.onInvalidMessage(
        error instanceof Error ? error : new Error("ACP JSON parse failed."),
        line,
      );
      return;
    }

    if (!isRecord(parsed)) {
      this.#options.onInvalidMessage(new Error("ACP JSON-RPC message must be an object."), line);
      return;
    }

    if (readString(parsed, "method") !== null) {
      await this.#handleInboundRequestOrNotification(parsed);
      return;
    }

    this.#handleInboundResponse(parsed);
  }

  async #handleInboundRequestOrNotification(message: JsonObject): Promise<void> {
    const method = readString(message, "method");

    if (method === null) {
      return;
    }

    const id = toJsonRpcId(message["id"]);
    const params = message["params"];

    if (id === null) {
      await this.#options.onNotification({ method, params });
      return;
    }

    try {
      const result = await this.#options.onRequest({ id, method, params });
      await this.#write({
        id,
        jsonrpc: JSON_RPC_VERSION,
        result,
      });
    } catch (error) {
      const rpcError =
        error instanceof AcpJsonRpcError
          ? error
          : new AcpJsonRpcError({
              code: INTERNAL_ERROR,
              message: error instanceof Error ? error.message : "ACP request handler failed.",
            });
      await this.#write({
        error: {
          code: rpcError.code,
          data: rpcError.data,
          message: rpcError.message,
        },
        id,
        jsonrpc: JSON_RPC_VERSION,
      });
    }
  }

  #handleInboundResponse(message: JsonObject): void {
    const id = toJsonRpcId(message["id"]);

    if (id === null) {
      return;
    }

    const pending = this.#pending.get(id);

    if (!pending) {
      return;
    }

    this.#pending.delete(id);
    const error = isRecord(message["error"]) ? message["error"] : null;

    if (error !== null) {
      pending.reject(
        new AcpJsonRpcError({
          code: typeof error["code"] === "number" ? error["code"] : INTERNAL_ERROR,
          data: error["data"],
          message: readString(error, "message") ?? "ACP request failed.",
        }),
      );
      return;
    }

    pending.resolve(message["result"]);
  }

  async #write(message: JsonObject): Promise<void> {
    if (this.#closed) {
      throw new Error("ACP JSON-RPC connection is closed.");
    }

    const line = `${JSON.stringify(message)}\n`;

    if (this.#options.stdin.write(line)) {
      return;
    }

    await Promise.race([
      once(this.#options.stdin, "drain").then(() => undefined),
      once(this.#options.stdin, "error").then(([error]) => {
        throw toStreamError(error, "ACP stdin failed.");
      }),
      once(this.#options.stdin, "close").then(() => {
        throw new Error("ACP stdin closed before the write drained.");
      }),
    ]);
  }

  #failTransport(error: Error): void {
    if (this.#closed) {
      return;
    }

    this.#options.onTransportError(error);
    this.close(error.message);
  }

  #closePending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export function createAcpMethodNotFoundError(method: string): AcpJsonRpcError {
  return new AcpJsonRpcError({
    code: METHOD_NOT_FOUND,
    message: `ACP method is not supported: ${method}.`,
  });
}

function toStreamError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage);
}
