import { expect, mock, test } from "bun:test";

import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

// Isolate cloudflare:workers and SDK mocks from the other API integration tests.
if (process.env.MOSOO_TEST_SANDBOX_OBSERVATION === "1") {
  let initializations = 0;
  let executions = 0;
  let destructions = 0;
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
    },
  }));

  const { Sandbox } = await import("../src/adapters/durable-objects/sandbox.do");
  function fixture(running?: boolean, corrupt = false) {
    let reads = 0;
    const ctx = {
      ...(running === undefined ? {} : { container: { running } }),
      storage: {
        async get() {
          reads++;
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
    expect(reads()).toBe(1);
    expect(executions).toBe(2);
    sandbox.getContainerObservation();
    expect(initializations).toBe(before + 1);
    expect(reads()).toBe(1);
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
