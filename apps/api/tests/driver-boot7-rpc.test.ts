import { describe, expect, test } from "bun:test";

import { call } from "@orpc/server";

import { runtimeOrpcRouter } from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";
import type { RuntimeOrpcContext } from "../src/modules/runtime/infrastructure/driver-instance/rpc-wire";

describe("Boot7 RPC boundary", () => {
  test("rejects terminals without a Run and preserves the explicit Run through the wire", async () => {
    const received: unknown[] = [];
    const context = {
      onCompleteRun: async (input: unknown) => {
        received.push(input);
        return { ok: true };
      },
      onFailRun: async (input: unknown) => {
        received.push(input);
        return { ok: true };
      },
    } as RuntimeOrpcContext;
    const identity = { driverInstanceId: "driver-1", runId: "run-previous" };
    const error = { code: "failed", message: "Failed", details: {}, retryable: false };

    await expect(
      call(runtimeOrpcRouter.driver.completeRun, { driverInstanceId: "driver-1" } as never, {
        context,
      }),
    ).rejects.toThrow();
    await expect(
      call(runtimeOrpcRouter.driver.failRun, { driverInstanceId: "driver-1", error } as never, {
        context,
      }),
    ).rejects.toThrow();
    expect(received).toEqual([]);

    await expect(
      call(runtimeOrpcRouter.driver.completeRun, identity, { context }),
    ).resolves.toEqual({ ok: true });
    await expect(
      call(runtimeOrpcRouter.driver.failRun, { ...identity, error }, { context }),
    ).resolves.toEqual({ ok: true });
    expect(received).toEqual([identity, { ...identity, error }]);
  });

  test("requires failure details and carries the complete MCP result to persistence", async () => {
    const received: unknown[] = [];
    const context = {
      onCommandUpdate: async (input: unknown) => {
        received.push(input);
        return { ok: true };
      },
    } as RuntimeOrpcContext;
    const identity = { driverInstanceId: "driver-1", commandId: "command-1" };
    await expect(
      call(runtimeOrpcRouter.driver.commandUpdate, { ...identity, status: "failed" } as never, {
        context,
      }),
    ).rejects.toThrow();
    expect(received).toEqual([]);

    const result = {
      requestId: "request-1",
      serverId: "server-1",
      toolName: "write",
      outputText: "denied",
      isError: true,
    };
    const update = { ...identity, status: "completed" as const, result };
    await expect(
      call(runtimeOrpcRouter.driver.commandUpdate, update, { context }),
    ).resolves.toEqual({ ok: true });
    expect(received).toEqual([update]);
  });
});
