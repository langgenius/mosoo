import { describe, expect, test } from "bun:test";

import {
  connectDriverSocketThroughSandbox,
  waitForDriverControlPort,
} from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-socket-connection";
import type { RuntimeProcessHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

function createRuntimeProcessHandle(
  waitForPort: RuntimeProcessHandle["waitForPort"],
): RuntimeProcessHandle {
  return {
    async getLogs() {
      throw new Error("getLogs is not used in this test.");
    },
    async getStatus() {
      throw new Error("getStatus is not used in this test.");
    },
    id: "process-1",
    async kill() {
      throw new Error("kill is not used in this test.");
    },
    pid: 123,
    async waitForExit() {
      throw new Error("waitForExit is not used in this test.");
    },
    waitForPort,
  };
}

describe("runtime driver socket connection", () => {
  test("uses the Sandbox SDK process port readiness check before socket connection", async () => {
    const calls: Array<{
      mode: Parameters<RuntimeProcessHandle["waitForPort"]>[1]["mode"];
      port: number;
    }> = [];
    const process = createRuntimeProcessHandle(async (port, options) => {
      calls.push({ mode: options.mode, port });
    });

    await waitForDriverControlPort(process, 50_665);

    expect(calls).toContainEqual({
      mode: "tcp",
      port: 50_665,
    });
  });

  test("does not retry non-idempotent sandbox socket connection failures", async () => {
    let callCount = 0;
    const bindings = {
      DriverConnection: {
        get() {
          return {
            async fetch() {
              callCount += 1;
              return Response.json({ error: "driver connection rejected" }, { status: 403 });
            },
          };
        },
        idFromName() {
          return "driver-1";
        },
      },
    } as unknown as ApiBindings;

    await expect(
      connectDriverSocketThroughSandbox(bindings, {
        bootToken: "boot-token-1",
        driverControlPort: 50_665,
        driverInstanceId: "driver-1",
        sandboxId: "01J0000000000000000000000D",
        traceparent: "traceparent-1",
      }),
    ).rejects.toThrow();

    expect(callCount).toBe(1);
  });
});
