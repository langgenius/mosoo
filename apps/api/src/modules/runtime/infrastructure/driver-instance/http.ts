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
  acceptDriverSocket(request: Request): Promise<Response>;
  destroy(reason: string): Promise<void>;
  fail(message: string): Promise<void>;
  sendControlCommand(command: RuntimeCommand): Promise<void>;
  snapshot(): DriverInstanceSnapshot;
  waitForClose(timeoutMs: number): Promise<DriverInstanceWaitForCloseResult>;
  waitForHeartbeat(afterCount: number, timeoutMs: number): Promise<DriverInstanceHeartbeatResult>;
  waitForHello(timeoutMs: number): Promise<DriverInstanceHelloResult>;
  waitForReady(timeoutMs: number): Promise<DriverInstanceReadyResult>;
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

  if (request.method === "GET" && url.pathname === "/driver-socket") {
    return handler.acceptDriverSocket(request);
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
