import { describe, expect, test } from "bun:test";

import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import type { DriverInstanceHttpHandler } from "../src/modules/runtime/infrastructure/driver-instance/http";
import { handleDriverInstanceRequest } from "../src/modules/runtime/infrastructure/driver-instance/http";

interface CapturingDriverInstanceHttpHandler extends DriverInstanceHttpHandler {
  readonly destroyGenerations: number[];
  readonly destroyReasons: string[];
  readonly driverSocketRequests: Request[];
  readonly readyGenerations: number[];
}

function createDriverInstanceHttpHandler(): CapturingDriverInstanceHttpHandler {
  const destroyGenerations: number[] = [];
  const destroyReasons: string[] = [];
  const driverSocketRequests: Request[] = [];
  const readyGenerations: number[] = [];

  return {
    destroyGenerations,
    destroyReasons,
    driverSocketRequests,
    readyGenerations,
    async acceptDriverSocket(request: Request): Promise<Response> {
      driverSocketRequests.push(request);
      return Response.json({ ok: true });
    },
    async destroy(generation: number, reason: string): Promise<void> {
      destroyGenerations.push(generation);
      destroyReasons.push(reason);
    },
    async fail(_generation: number, _message: string): Promise<void> {
      throw new Error("Unexpected fail call.");
    },
    async sendControlCommand(_generation: number, _command: RuntimeCommand): Promise<void> {
      throw new Error("Unexpected command call.");
    },
    snapshot() {
      throw new Error("Unexpected snapshot call.");
    },
    async waitForClose() {
      throw new Error("Unexpected close wait call.");
    },
    async waitForReady(generation: number) {
      readyGenerations.push(generation);
      return {
        heartbeatCount: 0,
        lastHeartbeatAt: null,
        ready: {
          at: "2026-01-01T00:00:00.000Z",
          driverInstanceId: "driver-instance",
          pid: 1,
        },
      };
    },
  };
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
  test("routes driver socket upgrades to the accept handler", async () => {
    const handler = createDriverInstanceHttpHandler();
    const response = await handleDriverInstanceRequest(
      handler,
      new Request("https://driver.local/driver-socket?token=boot-token&traceparent=tp-1", {
        headers: { Upgrade: "websocket" },
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    expect(handler.driverSocketRequests).toHaveLength(1);
    const forwarded = handler.driverSocketRequests[0];
    expect(new URL(forwarded?.url ?? "").searchParams.get("token")).toBe("boot-token");
  });

  test("does not route driver socket posts to the accept handler", async () => {
    const handler = createDriverInstanceHttpHandler();
    const response = await handleDriverInstanceRequest(
      handler,
      new Request("https://driver.local/driver-socket", { method: "POST" }),
    );

    expect(response.status).toBe(404);
    expect(handler.driverSocketRequests).toHaveLength(0);
  });

  test("requires and preserves the exact ready generation", async () => {
    const handler = createDriverInstanceHttpHandler();
    const missing = await handleDriverInstanceRequest(
      handler,
      new Request("https://driver.local/wait/ready?timeoutMs=1000"),
    ).catch((error: unknown) => error);

    expect(missing).toBeInstanceOf(TypeError);
    const response = await handleDriverInstanceRequest(
      handler,
      new Request("https://driver.local/wait/ready?generation=7&timeoutMs=1000"),
    );
    expect(response.status).toBe(200);
    expect(handler.readyGenerations).toEqual([7]);
  });

  test("removes unused hello and heartbeat wait routes", async () => {
    const handler = createDriverInstanceHttpHandler();

    for (const path of ["/wait/hello", "/wait/heartbeat"]) {
      const response = await handleDriverInstanceRequest(
        handler,
        new Request(`https://driver.local${path}?timeoutMs=1000`),
      );
      expect(response.status).toBe(404);
    }
  });

  test("uses the default destroy reason while preserving the exact generation", async () => {
    const { handler, payload, response } = await postDestroyRequest('{"generation":3}');

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(handler.destroyGenerations).toEqual([3]);
    expect(handler.destroyReasons).toEqual(["runtime.driver_instance.destroyed"]);
  });

  test("rejects a destroy without a generation", async () => {
    const { handler, response } = await postDestroyRequest();

    expect(response.status).toBe(400);
    expect(handler.destroyGenerations).toEqual([]);
    expect(handler.destroyReasons).toEqual([]);
  });

  test("rejects malformed destroy JSON instead of silently using the default reason", async () => {
    const { handler, payload, response } = await postDestroyRequest("{");

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: expect.stringContaining("JSON"),
    });
    expect(handler.destroyReasons).toEqual([]);
  });

  test("rejects an invalid runtime command at the HTTP boundary", async () => {
    const handler = createDriverInstanceHttpHandler();
    const response = await handleDriverInstanceRequest(
      handler,
      new Request("https://driver.local/control/send", {
        body: JSON.stringify({ commandId: "command-1", kind: "input.start" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
  });
});
