import { parsePlatformId } from "@mosoo/id";
import type {
  CredentialId,
  DriverInstanceId,
  McpServerId,
  SandboxId,
  SkillSnapshotId,
} from "@mosoo/id";
import type { DriverBootPayload, DriverRuntime, DriverRuntimeTransport } from "agent-driver/boot";
import { DRIVER_PROTOCOL_VERSION, parseDriverBootPayload } from "agent-driver/boot";

export interface CreateBootPayloadInput {
  bootToken: string;
  driverControlPort: number;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
  execution: unknown;
  heartbeatIntervalMs: number;
  runtime: DriverRuntime;
  runtimeTransport: DriverRuntimeTransport;
  sandboxId: SandboxId;
  traceparent: string;
}

export type RuntimeActionTokenAction =
  | "credential_invalidate"
  | "credential_refresh"
  | "mcp_proxy"
  | "skill_snapshot";

interface RuntimeActionTokenPayloadBase {
  driverInstanceId: DriverInstanceId;
  expiresAt: number;
}

export type RuntimeActionTokenPayload =
  | (RuntimeActionTokenPayloadBase & {
      action: "credential_invalidate" | "credential_refresh";
      resourceId: CredentialId;
    })
  | (RuntimeActionTokenPayloadBase & {
      action: "mcp_proxy";
      resourceId: McpServerId;
    })
  | (RuntimeActionTokenPayloadBase & {
      action: "skill_snapshot";
      resourceId: SkillSnapshotId;
    });

export interface RuntimeActionTokenBindings {
  readonly RUNTIME_ACTION_TOKEN_SECRET: string;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";

  for (const byte of value) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    const byte = binary.codePointAt(index);

    if (byte === undefined) {
      throw new Error("Base64url payload is invalid.");
    }

    bytes[index] = byte;
  }

  return bytes;
}

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer instanceof ArrayBuffer
    ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    : Uint8Array.from(value).buffer;
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(toUtf8Bytes(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    usages,
  );
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(value));
  return new Uint8Array(digest);
}

export async function createOpaqueBootToken(): Promise<{
  encoded: string;
  hash: Uint8Array;
}> {
  const raw = crypto.getRandomValues(new Uint8Array(32));

  return {
    encoded: encodeBase64Url(raw),
    hash: await sha256(raw),
  };
}

export async function decodeAndHashBootToken(encoded: string): Promise<Uint8Array> {
  const raw = decodeBase64Url(encoded);

  if (raw.byteLength !== 32) {
    throw new Error("Boot token format is invalid.");
  }

  return sha256(raw);
}

function requireRuntimeActionTokenSecret(bindings: RuntimeActionTokenBindings): string {
  const secret = bindings.RUNTIME_ACTION_TOKEN_SECRET.trim();

  if (secret === "") {
    throw new Error("RUNTIME_ACTION_TOKEN_SECRET is required.");
  }

  return secret;
}

export async function createRuntimeActionToken(
  bindings: RuntimeActionTokenBindings,
  payload: RuntimeActionTokenPayload,
): Promise<string> {
  const encodedPayload = encodeBase64Url(toUtf8Bytes(JSON.stringify(payload)));
  const key = await importHmacKey(requireRuntimeActionTokenSecret(bindings), ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(toUtf8Bytes(encodedPayload)),
  );

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function isRuntimeActionTokenAction(value: unknown): value is RuntimeActionTokenAction {
  return (
    value === "credential_invalidate" ||
    value === "credential_refresh" ||
    value === "mcp_proxy" ||
    value === "skill_snapshot"
  );
}

function isRuntimeActionTokenPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuntimeActionTokenPayload(encodedPayload: string): RuntimeActionTokenPayload {
  const parsed: unknown = JSON.parse(decodeUtf8(decodeBase64Url(encodedPayload)));

  if (!isRuntimeActionTokenPayloadRecord(parsed)) {
    throw new Error("Runtime action token payload is invalid.");
  }

  const { action, driverInstanceId, expiresAt, resourceId } = parsed;

  if (
    !isRuntimeActionTokenAction(action) ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    typeof resourceId !== "string" ||
    resourceId === "" ||
    typeof driverInstanceId !== "string" ||
    driverInstanceId === ""
  ) {
    throw new Error("Runtime action token payload is invalid.");
  }

  const parsedDriverInstanceId = parsePlatformId<DriverInstanceId>(
    driverInstanceId,
    "Runtime action token driver instance ID",
  );

  if (action === "mcp_proxy") {
    return {
      action,
      driverInstanceId: parsedDriverInstanceId,
      expiresAt,
      resourceId: parsePlatformId<McpServerId>(resourceId, "Runtime action token MCP server ID"),
    };
  }

  if (action === "skill_snapshot") {
    return {
      action,
      driverInstanceId: parsedDriverInstanceId,
      expiresAt,
      resourceId: parsePlatformId<SkillSnapshotId>(
        resourceId,
        "Runtime action token skill snapshot ID",
      ),
    };
  }

  return {
    action,
    driverInstanceId: parsedDriverInstanceId,
    expiresAt,
    resourceId: parsePlatformId<CredentialId>(resourceId, "Runtime action token credential ID"),
  };
}

export async function verifyRuntimeActionToken(
  bindings: RuntimeActionTokenBindings,
  rawToken: string,
): Promise<RuntimeActionTokenPayload> {
  const [encodedPayload, encodedSignature] = rawToken.split(".");

  if (
    encodedPayload === undefined ||
    encodedPayload === "" ||
    encodedSignature === undefined ||
    encodedSignature === ""
  ) {
    throw new Error("Runtime action token is invalid.");
  }

  const key = await importHmacKey(requireRuntimeActionTokenSecret(bindings), ["verify"]);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(decodeBase64Url(encodedSignature)),
    toArrayBuffer(toUtf8Bytes(encodedPayload)),
  );

  if (!verified) {
    throw new Error("Runtime action token signature is invalid.");
  }

  const parsed = parseRuntimeActionTokenPayload(encodedPayload);

  if (parsed.expiresAt <= Date.now()) {
    throw new Error("Runtime action token has expired.");
  }

  return parsed;
}

export function createDriverBootPayload(input: CreateBootPayloadInput): DriverBootPayload {
  return parseDriverBootPayload({
    bootToken: input.bootToken,
    driverControlPort: input.driverControlPort,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    execution: input.execution,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    protocolVersion: DRIVER_PROTOCOL_VERSION,
    runtime: input.runtime,
    runtimeTransport: input.runtimeTransport,
    sandboxId: input.sandboxId,
    traceparent: input.traceparent,
  });
}
