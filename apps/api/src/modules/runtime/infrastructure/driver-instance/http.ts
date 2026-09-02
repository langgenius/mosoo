import { parseRuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import { json, readPositiveTimeout, toErrorMessage } from "./driver-instance-support";
import type {
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";

export interface DriverInstanceHttpHandler {
  acceptDriverSocket(request: Request): Promise<Response>;
  destroy(generation: number, reason: string): Promise<void>;
  fail(generation: number, message: string): Promise<void>;
  sendControlCommand(generation: number, command: RuntimeCommand): Promise<void>;
  snapshot(): DriverInstanceSnapshot;
  waitForClose(generation: number, timeoutMs: number): Promise<DriverInstanceWaitForCloseResult>;
  waitForReady(generation: number, timeoutMs: number): Promise<DriverInstanceReadyResult>;
}

interface RuntimeFailRequest {
  generation: number;
  message?: string;
}

interface RuntimeCloseRequest {
  generation: number;
  reason?: string;
}

interface RuntimeSendRequest {
  command: RuntimeCommand;
  generation: number;
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
  const generation = record["generation"];
  const message = readOptionalString(record, "message", requestName);

  if (!Number.isSafeInteger(generation) || (generation as number) < 0) {
    throw new TypeError(`${requestName}.generation must be a non-negative safe integer.`);
  }

  return message === undefined
    ? { generation: generation as number }
    : { generation: generation as number, message };
}

function parseCloseRequest(value: unknown): RuntimeCloseRequest {
  const requestName = "RuntimeCloseRequest";
  const record = readObject(value, requestName);
  const generation = record["generation"];
  const reason = readOptionalString(record, "reason", requestName);

  if (!Number.isSafeInteger(generation) || (generation as number) < 0) {
    throw new TypeError(`${requestName}.generation must be a non-negative safe integer.`);
  }

  return reason === undefined
    ? { generation: generation as number }
    : { generation: generation as number, reason };
}

function parseSendRequest(value: unknown): RuntimeSendRequest {
  const requestName = "RuntimeSendRequest";
  const record = readObject(value, requestName);
  const generation = record["generation"];

  if (!Number.isSafeInteger(generation) || (generation as number) < 0) {
    throw new TypeError(`${requestName}.generation must be a non-negative safe integer.`);
  }

  return {
    command: parseRuntimeCommand(record["command"]),
    generation: generation as number,
  };
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text.trim().length === 0 ? {} : JSON.parse(text);
}

function readGeneration(url: URL): number {
  const value = url.searchParams.get("generation");
  const generation = value === null || value.trim().length === 0 ? Number.NaN : Number(value);

  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("generation must be a non-negative safe integer.");
  }

  return generation;
}

export async function handleDriverInstanceRequest(
  handler: DriverInstanceHttpHandler,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/driver-socket") {
    return handler.acceptDriverSocket(request);
  }

  if (request.method === "GET" && url.pathname === "/wait/ready") {
    return json(await handler.waitForReady(readGeneration(url), readPositiveTimeout(url, "ready")));
  }

  if (request.method === "GET" && url.pathname === "/wait/close") {
    return json(await handler.waitForClose(readGeneration(url), readPositiveTimeout(url, "close")));
  }

  if (request.method === "GET" && url.pathname === "/snapshot") {
    return json(handler.snapshot());
  }

  if (request.method === "POST" && url.pathname === "/control/send") {
    let body: RuntimeSendRequest;

    try {
      body = parseSendRequest(await request.json());
    } catch (error) {
      return json(
        {
          error: toErrorMessage(error, "Runtime command payload is invalid."),
        },
        { status: 400 },
      );
    }

    await handler.sendControlCommand(body.generation, body.command);
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

    await handler.fail(body.generation, message);
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
      body.generation,
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason
        : "runtime.driver_instance.destroyed",
    );
    return json({ ok: true });
  }

  return json({ error: "Not Found" }, { status: 404 });
}
