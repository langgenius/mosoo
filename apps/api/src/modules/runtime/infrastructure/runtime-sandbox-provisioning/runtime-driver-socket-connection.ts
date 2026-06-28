import { sleepPromise } from "@mosoo/effects";
import type { DriverInstanceId, SandboxId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import {
  connectDriverInstanceSandboxWebSocket,
  waitForDriverInstanceHello,
} from "../driver-instance/client";
import type { RuntimeProcessHandle } from "../sandbox-handles";
import {
  DRIVER_SOCKET_ALREADY_CONNECTED_HELLO_MS,
  DRIVER_SOCKET_CONNECT_RETRY_MS,
  DRIVER_SOCKET_CONNECT_TIMEOUT_MS,
} from "./runtime-driver-provisioning-settings";

function isDriverSocketAlreadyConnectedError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("Driver control socket is already connected")
  );
}

function isTransientSandboxSocketConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Container is not listening to port");
}

export async function waitForDriverControlPort(
  process: RuntimeProcessHandle,
  port: number,
): Promise<void> {
  await process.waitForPort(port, {
    interval: DRIVER_SOCKET_CONNECT_RETRY_MS,
    mode: "tcp",
    timeout: DRIVER_SOCKET_CONNECT_TIMEOUT_MS,
  });
}

export async function connectDriverSocketThroughSandbox(
  env: ApiBindings,
  input: {
    bootToken: string;
    driverControlPort: number;
    driverInstanceId: DriverInstanceId;
    sandboxId: SandboxId;
    traceparent: string;
  },
): Promise<void> {
  const deadlineMs = Date.now() + DRIVER_SOCKET_CONNECT_TIMEOUT_MS;

  try {
    while (true) {
      try {
        await connectDriverInstanceSandboxWebSocket(env, input.driverInstanceId, {
          bootToken: input.bootToken,
          port: input.driverControlPort,
          sandboxId: input.sandboxId,
          traceparent: input.traceparent,
        });
        return;
      } catch (error) {
        if (!isTransientSandboxSocketConnectionError(error) || Date.now() >= deadlineMs) {
          throw error;
        }

        await sleepPromise(DRIVER_SOCKET_CONNECT_RETRY_MS);
      }
    }
  } catch (error) {
    if (!isDriverSocketAlreadyConnectedError(error)) {
      throw error;
    }

    await waitForDriverInstanceHello(
      env,
      input.driverInstanceId,
      DRIVER_SOCKET_ALREADY_CONNECTED_HELLO_MS,
    );
  }
}
