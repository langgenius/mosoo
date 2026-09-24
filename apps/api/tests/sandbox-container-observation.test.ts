import { expect, mock, test } from "bun:test";

import { SANDBOX_MIGRATION_FENCE_STORAGE_KEY } from "../src/adapters/durable-objects/sandbox-migration-fence";
import { SANDBOX_RPC_FORWARD_METHODS } from "../src/adapters/durable-objects/sandbox-rpc-methods";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

// Isolate cloudflare:workers and SDK mocks from the other API integration tests.
if (process.env.MOSOO_TEST_SANDBOX_OBSERVATION === "1") {
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
  function fixture(running?: boolean, corrupt = false, persistedFence?: unknown) {
    let reads = 0;
    const ctx = {
      id: { toString: () => "sandbox-observation" },
      ...(running === undefined ? {} : { container: { running } }),
      storage: {
        async get(key: string) {
          reads++;
          if (key === SANDBOX_MIGRATION_FENCE_STORAGE_KEY) return persistedFence;
          return corrupt ? { networkPolicy: "unknown" } : undefined;
        },
      },
    };
    const sandbox = new Sandbox(ctx as unknown as DurableObjectState, {} as ApiBindings);
    return { sandbox, reads: () => reads };
  }

  for (const [running, state] of [
    [true, "running"],
    [false, "stopped"],
    [undefined, "unavailable"],
  ] as const) {
    test(`observes ${state} without SDK initialization or storage access`, async () => {
      const before = initializations;
      const { sandbox, reads } = fixture(running, true);
      const started = Date.now();
      const observed = sandbox.getContainerObservation();
      await Promise.resolve();
      expect(observed.state).toBe(state);
      expect(observed.observedAt).toBeGreaterThanOrEqual(started);
      expect(observed.observedAt).toBeLessThanOrEqual(Date.now());
      expect(initializations).toBe(before);
      expect(reads()).toBe(0);
    });
  }

  test("concurrent access still initializes and restores the SDK exactly once", async () => {
    const before = initializations;
    const { sandbox, reads } = fixture(false);
    const exec = Reflect.get(sandbox, "exec") as () => Promise<unknown>;
    await Promise.all([exec.call(sandbox), exec.call(sandbox)]);
    expect(initializations).toBe(before + 1);
    expect(reads()).toBe(2);
    expect(executions).toBe(2);
    sandbox.getContainerObservation();
    expect(initializations).toBe(before + 1);
    expect(reads()).toBe(2);
  });

  test("corrupt policy still blocks execution and permits teardown and observation", async () => {
    const before = executions;
    const { sandbox } = fixture(false, true);
    const exec = Reflect.get(sandbox, "exec") as () => Promise<unknown>;
    await expect(exec.call(sandbox)).rejects.toThrow("unknown network policy");
    expect(executions).toBe(before);
    const destroy = Reflect.get(sandbox, "destroy") as () => Promise<void>;
    await destroy.call(sandbox);
    expect(destructions).toBe(1);
    expect(sandbox.getContainerObservation().state).toBe("stopped");
  });

  test("teardown can be the first access even when policy restoration rejects", async () => {
    const before = destructions;
    const { sandbox } = fixture(false, true);
    const destroy = Reflect.get(sandbox, "destroy") as () => Promise<void>;
    await destroy.call(sandbox);
    expect(destructions).toBe(before + 1);
    expect(sandbox.getContainerObservation().state).toBe("stopped");
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

  test("a persisted fence blocks every SDK ingress without initializing the delegate", async () => {
    const before = initializations;
    const { sandbox } = fixture(false, false, {
      revision: 0,
      active: { operationId: "migration", bootId: "previous-actor" },
      releasedOperationId: null,
    });
    for (const method of SANDBOX_RPC_FORWARD_METHODS) {
      const action = Reflect.get(sandbox, method) as () => Promise<unknown>;
      await expect(action.call(sandbox)).rejects.toThrow("migration fence is held");
    }
    await expect(sandbox.configureNetworkConstraints({})).rejects.toThrow(
      "migration fence is held",
    );
    await expect(sandbox.ensureContainerReady({ allowRecovery: true })).rejects.toThrow(
      "migration fence is held",
    );
    await expect(sandbox.fetch(new Request("https://sandbox.test"))).rejects.toThrow(
      "migration fence is held",
    );
    await sandbox.alarm();
    expect(await sandbox.getMigrationFence()).toMatchObject({
      operationId: "migration",
      resetRequired: false,
      state: "stopped",
    });
    expect(initializations).toBe(before);
  });

  test("corrupt policy blocks explicit startup before any container attempt", async () => {
    let attempts = 0;
    onStartup = async () => {
      attempts++;
    };
    try {
      const { sandbox } = fixture(false, true);
      await expect(sandbox.ensureContainerReady({ allowRecovery: true })).rejects.toThrow(
        "unknown network policy",
      );
      expect(attempts).toBe(0);
    } finally {
      onStartup = async () => {};
    }
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
  test("actual Sandbox wrapper observation and lazy initialization", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", import.meta.path],
      env: { ...process.env, MOSOO_TEST_SANDBOX_OBSERVATION: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(`Sandbox observation regression failed:\n${stdout}${stderr}`);
    expect(status).toBe(0);
  }, 10_000);
}
