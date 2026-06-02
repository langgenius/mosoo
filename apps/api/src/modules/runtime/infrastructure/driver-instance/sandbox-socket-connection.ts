import { getSandbox } from "@cloudflare/sandbox";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { decodeAndHashBootToken } from "../runtime-boot-token";
import { toSandboxHandle } from "../sandbox-handles";
import type { SandboxHandle } from "../sandbox-handles";
import { RUNTIME_TRACEPARENT_HEADER } from "./client";
import { claimDriverInstanceByBootTokenHash } from "./driver-instance-token.repository";
import type { DriverInstanceSandboxSocketRequest } from "./http";
import { requireSandboxBinding } from "./sandbox-binding";

interface DriverSandboxSocketConnectionOptions {
  acceptDriverSocket: (
    socket: WebSocket,
    traceparent: string | null,
    bootTokenHash: Uint8Array,
    driverGeneration: number,
  ) => Promise<void>;
  env: ApiBindings;
  requireDriverInstanceId: () => string;
}

function enforceDriverControlPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || port === 3000) {
    throw new Error(
      "Driver control port must be an integer between 1024 and 65535, excluding 3000.",
    );
  }
}

async function readResponseError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim() || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function createDriverSocketRequest(input: DriverInstanceSandboxSocketRequest): Request {
  return new Request(
    `https://driver-control.internal/driver?token=${encodeURIComponent(
      input.bootToken,
    )}&traceparent=${encodeURIComponent(input.traceparent)}`,
    {
      headers: {
        Connection: "Upgrade",
        [RUNTIME_TRACEPARENT_HEADER]: input.traceparent,
        Upgrade: "websocket",
      },
    },
  );
}

async function connectSandboxDriverSocket(
  sandbox: SandboxHandle,
  input: DriverInstanceSandboxSocketRequest,
): Promise<Response> {
  const response = await sandbox.wsConnect(createDriverSocketRequest(input), input.port);

  if (response.status === 101) {
    return response;
  }

  throw new Error(`Sandbox driver WebSocket rejected: ${await readResponseError(response)}`);
}

export async function connectDriverInstanceSandboxSocket(
  input: DriverInstanceSandboxSocketRequest,
  options: DriverSandboxSocketConnectionOptions,
): Promise<void> {
  enforceDriverControlPort(input.port);

  const driverInstanceId = options.requireDriverInstanceId();
  const bootTokenHash = await decodeAndHashBootToken(input.bootToken);
  const sandbox = toSandboxHandle(
    getSandbox(requireSandboxBinding(options.env), input.sandboxId, {
      keepAlive: true,
      normalizeId: true,
    }),
  );
  const response = await connectSandboxDriverSocket(sandbox, input);

  const socket = (response as Response & { webSocket?: WebSocket }).webSocket;

  if (!socket) {
    throw new Error("Sandbox driver WebSocket response did not include a socket.");
  }

  const claim = await claimDriverInstanceByBootTokenHash(options.env, bootTokenHash);

  if (claim.driverInstanceId !== driverInstanceId) {
    socket.close(1008, "runtime.boot-token.rejected");
    throw new Error(claim.error ?? "Driver boot token does not match this driver instance.");
  }

  if (claim.generation === null) {
    socket.close(1008, "runtime.boot-token.rejected");
    throw new Error(claim.error ?? "Driver boot token generation is missing.");
  }

  await options.acceptDriverSocket(socket, input.traceparent, bootTokenHash, claim.generation);
}
