import { describe, expect, test } from "bun:test";

import { createPromiseDeferred } from "@mosoo/effects";

import { SandboxStartup } from "../src/platform/cloudflare/sandbox-startup";

function createStartup(input: {
  start: (signal: AbortSignal) => Promise<void>;
  destroy?: () => Promise<void>;
  healthy?: boolean;
  running?: boolean;
  timeoutMs?: number;
}) {
  return new SandboxStartup(
    {
      getState: async () => ({ status: input.healthy ? "healthy" : "stopped", lastChange: 0 }),
      destroy: input.destroy ?? (async () => {}),
      startAndWaitForPorts: async (options) => {
        expect(options.ports).toBe(3000);
        return input.start(options.cancellationOptions.abort);
      },
    },
    { sandboxId: "startup-test", isRunning: () => input.running ?? false },
    input.timeoutMs,
  );
}

describe("sandbox container startup", () => {
  test("retries the production undefined startup error only after confirmed cold teardown", async () => {
    const calls: string[] = [];
    const destroyed = createPromiseDeferred<void>();
    const startup = createStartup({
      start: async () => {
        calls.push("start");
        if (calls.length === 1) throw undefined;
      },
      destroy: async () => {
        calls.push("destroy");
        await destroyed.promise;
      },
    });
    const ready = startup.ensureReady(true);
    await Bun.sleep(10);
    expect(calls).toEqual(["start", "destroy"]);
    destroyed.resolve();
    await ready;
    expect(calls).toEqual(["start", "destroy", "start"]);
  });

  test("bounds recovery to one retry and retains the failing attempt", async () => {
    let attempts = 0;
    let destroys = 0;
    const startup = createStartup({
      start: async () => {
        attempts += 1;
        throw new Error("internal error; reference = test-reference");
      },
      destroy: async () => {
        destroys += 1;
      },
    });
    await expect(startup.ensureReady(true)).rejects.toThrow(
      "startup attempt 2 internal error; reference = test-reference",
    );
    expect(attempts).toBe(2);
    expect(destroys).toBe(1);
  });

  test("does not recycle a warm subject or retry permanent configuration errors", async () => {
    for (const [allowRecovery, message] of [
      [false, "internal error; reference = warm"],
      [true, "no such image"],
    ] as const) {
      let attempts = 0;
      let destroys = 0;
      const startup = createStartup({
        start: async () => {
          attempts += 1;
          throw new Error(message);
        },
        destroy: async () => {
          destroys += 1;
        },
      });
      await expect(startup.ensureReady(allowRecovery)).rejects.toThrow(message);
      expect(attempts).toBe(1);
      expect(destroys).toBe(0);
    }
  });

  test("delivers the deadline to the real startup wait before recovering", async () => {
    const calls: string[] = [];
    const startup = createStartup({
      timeoutMs: 10,
      start: async (signal) => {
        calls.push("start");
        if (calls.length !== 1) return;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            calls.push("aborted");
            reject(new Error("Container request aborted."));
          });
        });
      },
      destroy: async () => {
        calls.push("destroy");
      },
    });
    await startup.ensureReady(true);
    expect(calls).toEqual(["start", "aborted", "destroy", "start"]);
  });

  test("teardown cancels and drains startup without launching recovery", async () => {
    const started = createPromiseDeferred<void>();
    let aborted = false;
    let attempts = 0;
    const startup = createStartup({
      start: async (signal) => {
        attempts += 1;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("Container request aborted."));
          });
          started.resolve();
        });
      },
    });
    const ready = startup.ensureReady(true).then(
      () => null,
      (error: unknown) => error,
    );
    await started.promise;
    await startup.cancelAndDrain();
    expect(await ready).toBeInstanceOf(Error);
    expect(aborted).toBe(true);
    expect(attempts).toBe(1);
    await startup.cancelAndDrain();
    expect(attempts).toBe(1);
  });

  test("does not tear down or retry while an aborted startup is still settling", async () => {
    const settle = createPromiseDeferred<void>();
    const aborted = createPromiseDeferred<void>();
    const calls: string[] = [];
    const startup = createStartup({
      timeoutMs: 10,
      start: async (signal) => {
        calls.push("start");
        if (calls.length !== 1) return;
        signal.addEventListener("abort", () => aborted.resolve());
        await settle.promise;
        calls.push("settled");
      },
      destroy: async () => {
        calls.push("destroy");
      },
    });
    const ready = startup.ensureReady(true);
    await aborted.promise;
    expect(calls).toEqual(["start"]);
    settle.resolve();
    await ready;
    expect(calls).toEqual(["start", "settled", "destroy", "start"]);
  });

  test("concurrent startup callers share one attempt and one cancellation barrier", async () => {
    const started = createPromiseDeferred<void>();
    const settle = createPromiseDeferred<void>();
    let attempts = 0;
    const startup = createStartup({
      start: async () => {
        attempts += 1;
        started.resolve();
        await settle.promise;
      },
    });
    const calls = [startup.ensureReady(true), startup.ensureReady(false)];
    const outcomes = Promise.allSettled(calls);
    await started.promise;
    let drained = false;
    const cleanup = Promise.all([startup.cancelAndDrain(), startup.cancelAndDrain()]).then(() => {
      drained = true;
    });
    await Bun.sleep(10);
    expect(drained).toBe(false);
    expect(attempts).toBe(1);
    settle.resolve();
    await cleanup;
    expect((await outcomes).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(attempts).toBe(1);
  });

  test("failed recovery teardown prevents a second start", async () => {
    let attempts = 0;
    const startup = createStartup({
      start: async () => {
        attempts += 1;
        throw undefined;
      },
      destroy: async () => {
        throw new Error("destroy not confirmed");
      },
    });
    await expect(startup.ensureReady(true)).rejects.toThrow("destroy not confirmed");
    expect(attempts).toBe(1);
  });

  test("checks physical liveness before treating stored healthy state as ready", async () => {
    let attempts = 0;
    for (const running of [true, false]) {
      await createStartup({
        healthy: true,
        running,
        start: async () => {
          attempts += 1;
        },
      }).ensureReady(false);
    }
    expect(attempts).toBe(1);
  });
});
