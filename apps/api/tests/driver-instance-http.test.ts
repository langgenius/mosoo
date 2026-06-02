import { describe, expect, test } from "bun:test";

import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import type {
  DriverInstanceHttpHandler,
  DriverInstanceSandboxSocketRequest,
} from "../src/modules/runtime/infrastructure/driver-instance/http";
import { handleDriverInstanceRequest } from "../src/modules/runtime/infrastructure/driver-instance/http";

interface CapturingDriverInstanceHttpHandler extends DriverInstanceHttpHandler {
  readonly destroyReasons: string[];
  readonly sandboxSocketRequests: DriverInstanceSandboxSocketRequest[];
}

function createDriverInstanceHttpHandler(): CapturingDriverInstanceHttpHandler {
  const destroyReasons: string[] = [];
  const sandboxSocketRequests: DriverInstanceSandboxSocketRequest[] = [];

  return {
    destroyReasons,
    sandboxSocketRequests,
    async connectDriverInstanceSandboxSocket(
      input: DriverInstanceSandboxSocketRequest,
    ): Promise<void> {
      sandboxSocketRequests.push(input);
    },
    async destroy(reason: string): Promise<void> {
      destroyReasons.push(reason);
    },
    async fail(_message: string): Promise<void> {
      throw new Error("Unexpected fail call.");
    },
    async sendControlCommand(_command: RuntimeCommand): Promise<void> {
      throw new Error("Unexpected command call.");
    },
    snapshot() {
      throw new Error("Unexpected snapshot call.");
    },
    async waitForClose() {
      throw new Error("Unexpected close wait call.");
    },
    async waitForHeartbeat() {
      throw new Error("Unexpected heartbeat wait call.");
    },
    async waitForHello() {
      throw new Error("Unexpected hello wait call.");
    },
    async waitForReady() {
      throw new Error("Unexpected ready wait call.");
    },
  };
}

async function postSandboxSocketRequest(port: unknown): Promise<{
  handler: CapturingDriverInstanceHttpHandler;
  payload: unknown;
  response: Response;
}> {
  const handler = createDriverInstanceHttpHandler();
  const response = await handleDriverInstanceRequest(
    handler,
    new Request("https://driver.local/sandbox/ws-connect", {
      body: JSON.stringify({
        bootToken: "boot-token",
        port,
        sandboxId: "01J0000000000000000000000D",
        traceparent: "traceparent-1",
      }),
      method: "POST",
    }),
  );
  const payload: unknown = await response.json();

  return { handler, payload, response };
}

async function postDestroyRequest(body?: string): Promise<{
  handler: CapturingDriverInstanceHttpHandler;
  payload: unknown;
  response: Response;
}> {
  const handler = createDriverInstanceHttpHandler();
  const response = await handleDriverInstanceRequest(
    handler,
    new Request("https://driver.local/control/destroy", {
      ...(body === undefined ? {} : { body }),
      method: "POST",
    }),
  );
  const payload: unknown = await response.json();

  return { handler, payload, response };
}

describe("driver instance HTTP boundary", () => {
  test("accepts sandbox socket requests with valid TCP ports", async () => {
    const { handler, payload, response } = await postSandboxSocketRequest(3_000);

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(handler.sandboxSocketRequests).toEqual([
      {
        bootToken: "boot-token",
        port: 3_000,
        sandboxId: "01J0000000000000000000000D",
        traceparent: "traceparent-1",
      },
    ]);
  });

  test.each([1023, 1024.5, 65_536, "3000", null])(
    "rejects invalid sandbox socket port %p",
    async (port) => {
      const { handler, payload, response } = await postSandboxSocketRequest(port);

      expect(response.status).toBe(400);
      expect(payload).toEqual({
        error: "DriverInstanceSandboxSocketRequest.port must be an integer between 1024 and 65535.",
      });
      expect(handler.sandboxSocketRequests).toEqual([]);
    },
  );

  test("uses the default destroy reason for an empty destroy body", async () => {
    const { handler, payload, response } = await postDestroyRequest();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(handler.destroyReasons).toEqual(["runtime.driver_instance.destroyed"]);
  });

  test("rejects malformed destroy JSON instead of silently using the default reason", async () => {
    const { handler, payload, response } = await postDestroyRequest("{");

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: expect.stringContaining("JSON"),
    });
    expect(handler.destroyReasons).toEqual([]);
  });
});
