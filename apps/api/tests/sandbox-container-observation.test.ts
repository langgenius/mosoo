import { expect, mock, test } from "bun:test";

import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

// Isolate cloudflare:workers and SDK mocks from the other API integration tests.
if (process.env.MOSOO_TEST_SANDBOX_WRAPPER === "1") {
  let initializations = 0;
  let executions = 0;
  let destructions = 0;
  let sessionReads = 0;
  let onStartup: (signal: AbortSignal) => Promise<void> = async () => {};
  mock.module("cloudflare:workers", () => ({
    DurableObject: class {
      constructor(
        readonly ctx: unknown,
        readonly env: unknown,
      ) {}
    },
  }));
  mock.module("@cloudflare/sandbox", () => ({
    Sandbox: class {
      enableInternet = true;
      envVars = {};
      interceptHttps = false;
      constructor() {
        initializations++;
      }
      async exec() {
        executions++;
        return { success: true };
      }
      async destroy() {
        destructions++;
      }
      async getState() {
        return { status: "stopped" };
      }
      async startAndWaitForPorts(options: { cancellationOptions: { abort: AbortSignal } }) {
        await onStartup(options.cancellationOptions.abort);
      }
      async createSession() {
        return {
          async readFile() {
            sessionReads++;
            return "synthetic file";
          },
        };
      }
    },
  }));

  const { Sandbox } = await import("../src/adapters/durable-objects/sandbox.do");
  function fixture(running: boolean) {
    let reads = 0;
    const ctx = {
      id: { toString: () => "sandbox-wrapper" },
      container: { running },
      storage: {
        async get() {
          reads++;
          return undefined;
        },
      },
    };
    const sandbox = new Sandbox(ctx as unknown as DurableObjectState, {} as ApiBindings);
    return { sandbox, reads: () => reads };
  }

  test("concurrent access still initializes and restores the SDK exactly once", async () => {
    const before = initializations;
    const { sandbox, reads } = fixture(false);
    const exec = Reflect.get(sandbox, "exec") as () => Promise<unknown>;
    await Promise.all([exec.call(sandbox), exec.call(sandbox)]);
    expect(initializations).toBe(before + 1);
    expect(reads()).toBe(1);
    expect(executions).toBe(2);
  });

  test("forwarded teardown invalidates old handles while fresh handles remain usable", async () => {
    const { sandbox } = fixture(false);
    const createSession = Reflect.get(sandbox, "createSession") as () => Promise<{
      readFile(): Promise<string>;
    }>;
    const destroy = Reflect.get(sandbox, "destroy") as () => Promise<void>;
    const old = await createSession.call(sandbox);
    expect(await old.readFile()).toBe("synthetic file");
    const before = sessionReads;
    await destroy.call(sandbox);
    await expect(old.readFile()).rejects.toThrow("invalidated by container teardown");
    expect(sessionReads).toBe(before);
    const fresh = await createSession.call(sandbox);
    expect(await fresh.readFile()).toBe("synthetic file");
    expect(sessionReads).toBe(before + 1);
  });

  test("forwarded teardown waits for startup cancellation without a recovery attempt", async () => {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    let attempts = 0;
    onStartup = async (signal) => {
      attempts++;
      signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      started.resolve();
      await drained.promise;
      signal.throwIfAborted();
    };
    try {
      const { sandbox } = fixture(false);
      const starting = sandbox
        .ensureContainerReady({ allowRecovery: true })
        .catch((error: unknown) => error);
      await started.promise;
      const before = destructions;
      const destroy = Reflect.get(sandbox, "destroy") as () => Promise<void>;
      const destroying = destroy.call(sandbox);
      await cancelled.promise;
      expect(destructions).toBe(before);
      drained.resolve();
      expect(await starting).toBeInstanceOf(Error);
      await destroying;
      expect(destructions).toBe(before + 1);
      expect(attempts).toBe(1);
    } finally {
      drained.resolve();
      onStartup = async () => {};
    }
  });
} else {
  test("actual Sandbox wrapper initialization and teardown", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", import.meta.path],
      env: { ...process.env, MOSOO_TEST_SANDBOX_WRAPPER: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(`Sandbox wrapper regression failed:\n${stdout}${stderr}`);
    expect(status).toBe(0);
  }, 10_000);
}
