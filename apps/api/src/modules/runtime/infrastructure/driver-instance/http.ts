import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import { json, readPositiveTimeout, toErrorMessage } from "./driver-instance-support";
import type {
  DriverInstanceHeartbeatResult,
  DriverInstanceHelloResult,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";

export interface DriverInstanceHttpHandler {
  connectDriverInstanceSandboxSocket(input: DriverInstanceSandboxSocketRequest): Promise<void>;
  destroy(reason: string): Promise<void>;
  fail(message: string): Promise<void>;
  sendControlCommand(command: RuntimeCommand): Promise<void>;
  snapshot(): DriverInstanceSnapshot;
  waitForClose(timeoutMs: number): Promise<DriverInstanceWaitForCloseResult>;
  waitForHeartbeat(afterCount: number, timeoutMs: number): Promise<DriverInstanceHeartbeatResult>;
  waitForHello(timeoutMs: number): Promise<DriverInstanceHelloResult>;
  waitForReady(timeoutMs: number): Promise<DriverInstanceReadyResult>;
}

export interface DriverInstanceSandboxSocketRequest {
  bootToken: string;
  port: number;
  sandboxId: string;
  traceparent: string;
}

interface RuntimeFailRequest {
  message?: string;
}

interface RuntimeCloseRequest {
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object.`);
  }

  return value;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  requestName: string,
): string {
  const value = record[key];

  if (typeof value !== "string") {
    throw new TypeError(`${requestName}.${key} must be a string.`);
  }

  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  requestName: string,
): string | undefined {
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${requestName}.${key} must be a string.`);
  }

  return value;
}

function parseSandboxSocketRequest(value: unknown): DriverInstanceSandboxSocketRequest {
  const requestName = "DriverInstanceSandboxSocketRequest";
  const record = readObject(value, requestName);
  const port = record["port"];

  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new TypeError(`${requestName}.port must be an integer between 1024 and 65535.`);
  }

  return {
    bootToken: readRequiredString(record, "bootToken", requestName),
    port,
    sandboxId: readRequiredString(record, "sandboxId", requestName),
    traceparent: readRequiredString(record, "traceparent", requestName),
  };
}

function parseFailRequest(value: unknown): RuntimeFailRequest {
  const requestName = "RuntimeFailRequest";
  const record = readObject(value, requestName);
  const message = readOptionalString(record, "message", requestName);

  return message === undefined ? {} : { message };
}

function parseCloseRequest(value: unknown): RuntimeCloseRequest {
  const requestName = "RuntimeCloseRequest";
  const record = readObject(value, requestName);
  const reason = readOptionalString(record, "reason", requestName);

  return reason === undefined ? {} : { reason };
}

function parseRuntimeCommand(value: unknown): RuntimeCommand {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    throw new TypeError("Runtime command must be an object with a string kind.");
  }

  return value as RuntimeCommand;
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text.trim().length === 0 ? {} : JSON.parse(text);
}

export async function handleDriverInstanceRequest(
  handler: DriverInstanceHttpHandler,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/sandbox/ws-connect") {
    let body: DriverInstanceSandboxSocketRequest;

    try {
      body = parseSandboxSocketRequest(await request.json());
    } catch (error) {
      return json(
        {
          error: toErrorMessage(error, "Sandbox WebSocket request is invalid."),
        },
        { status: 400 },
      );
    }

    await handler.connectDriverInstanceSandboxSocket(body);
    return json({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/wait/hello") {
    return json(await handler.waitForHello(readPositiveTimeout(url, "hello")));
  }

  if (request.method === "GET" && url.pathname === "/wait/ready") {
    return json(await handler.waitForReady(readPositiveTimeout(url, "ready")));
  }

  if (request.method === "GET" && url.pathname === "/wait/heartbeat") {
    const timeoutMs = readPositiveTimeout(url, "heartbeat");
    const afterCount = Number(url.searchParams.get("afterCount") ?? "0");

    if (!Number.isInteger(afterCount) || afterCount < 0) {
      return json({ error: "afterCount must be a non-negative integer." }, { status: 400 });
    }

    return json(await handler.waitForHeartbeat(afterCount, timeoutMs));
  }

  if (request.method === "GET" && url.pathname === "/wait/close") {
    return json(await handler.waitForClose(readPositiveTimeout(url, "close")));
  }

  if (request.method === "GET" && url.pathname === "/snapshot") {
    return json(handler.snapshot());
  }

  if (request.method === "POST" && url.pathname === "/control/send") {
    let command: RuntimeCommand;

    try {
      command = parseRuntimeCommand(await request.json());
    } catch (error) {
      return json(
        {
          error: toErrorMessage(error, "Runtime command payload is invalid."),
        },
        { status: 400 },
      );
    }

    await handler.sendControlCommand(command);
    return json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/control/fail") {
    let body: RuntimeFailRequest;

    try {
      body = parseFailRequest(await request.json());
    } catch (error) {
      return json(
        {
          error: toErrorMessage(error, "Runtime failure payload is invalid."),
        },
        { status: 400 },
      );
    }

    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : "Driver instance failed.";

    await handler.fail(message);
    return json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/control/destroy") {
    let body: RuntimeCloseRequest;

    try {
      body = parseCloseRequest(await readOptionalJsonBody(request));
    } catch (error) {
      return json(
        {
          error: toErrorMessage(error, "Driver instance destroy payload is invalid."),
        },
        { status: 400 },
      );
    }

    await handler.destroy(
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason
        : "runtime.driver_instance.destroyed",
    );
    return json({ ok: true });
  }

  return json({ error: "Not Found" }, { status: 404 });
}
