import type {
  DriverBootPayload,
  DriverRuntime,
  DriverRuntimeTransport,
} from "@mosoo/agent-driver/boot";
import { DRIVER_PROTOCOL_VERSION, parseDriverBootPayload } from "@mosoo/agent-driver/boot";
import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type {
  DriverInstanceId,
  McpServerId,
  ProjectId,
  SandboxId,
  SkillSnapshotId,
  VendorCredentialId,
} from "@mosoo/id";

import { fromBase64Url, toArrayBuffer, toBase64Url } from "../../../shared/bytes";

export interface CreateBootPayloadInput {
  bootToken: string;
  controlUrl: string;
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

interface RuntimeActionTokenPayloadBase {
  driverInstanceId: DriverInstanceId;
  expiresAt: number;
}

export type RuntimeActionTokenPayload =
  | (RuntimeActionTokenPayloadBase & {
      action: "llm_proxy";
      projectId: ProjectId;
      driverGeneration: number;
      imageModelId?: string;
      modelId: string;
      modelProtocol: PresetModelProtocol;
      resourceId: VendorCredentialId;
    })
  | (RuntimeActionTokenPayloadBase & {
      action: "mcp_proxy";
      driverGeneration: number;
      resourceId: McpServerId;
    })
  | (RuntimeActionTokenPayloadBase & {
      action: "skill_snapshot";
      resourceId: SkillSnapshotId;
    });

export interface RuntimeActionTokenBindings {
  readonly RUNTIME_ACTION_TOKEN_SECRET: string;
}

export const RUNTIME_LLM_PROXY_MODEL_ID_MAX_LENGTH = 512;

function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
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
    encoded: toBase64Url(raw),
    hash: await sha256(raw),
  };
}

export async function decodeAndHashBootToken(encoded: string): Promise<Uint8Array> {
  const raw = fromBase64Url(encoded);

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
  const encodedPayload = toBase64Url(toUtf8Bytes(JSON.stringify(payload)));
  const key = await importHmacKey(requireRuntimeActionTokenSecret(bindings), ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(toUtf8Bytes(encodedPayload)),
  );

  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
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
    toArrayBuffer(fromBase64Url(encodedSignature)),
    toArrayBuffer(toUtf8Bytes(encodedPayload)),
  );

  if (!verified) {
    throw new Error("Runtime action token signature is invalid.");
  }

  // Only this Worker signs action tokens, so a verified payload is trusted as written.
  const payload = JSON.parse(
    decodeUtf8(fromBase64Url(encodedPayload)),
  ) as RuntimeActionTokenPayload;

  if (payload.expiresAt <= Date.now()) {
    throw new Error("Runtime action token has expired.");
  }

  if (
    payload.action === "mcp_proxy" &&
    (!Number.isSafeInteger(payload.driverGeneration) || payload.driverGeneration < 0)
  ) {
    throw new Error("MCP proxy grant driver generation is invalid.");
  }

  return payload;
}

export function createDriverBootPayload(input: CreateBootPayloadInput): DriverBootPayload {
  return parseDriverBootPayload({
    bootToken: input.bootToken,
    controlUrl: input.controlUrl,
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
