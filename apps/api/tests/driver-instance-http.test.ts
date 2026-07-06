import { describe, expect, test } from "bun:test";

import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import type { DriverInstanceHttpHandler } from "../src/modules/runtime/infrastructure/driver-instance/http";
import { handleDriverInstanceRequest } from "../src/modules/runtime/infrastructure/driver-instance/http";

interface CapturingDriverInstanceHttpHandler extends DriverInstanceHttpHandler {
  readonly destroyReasons: string[];
  readonly driverSocketRequests: Request[];
}

function createDriverInstanceHttpHandler(): CapturingDriverInstanceHttpHandler {
  const destroyReasons: string[] = [];
  const driverSocketRequests: Request[] = [];

  return {
    destroyReasons,
    driverSocketRequests,
    async acceptDriverSocket(request: Request): Promise<Response> {
      driverSocketRequests.push(request);
      return Response.json({ ok: true });
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
