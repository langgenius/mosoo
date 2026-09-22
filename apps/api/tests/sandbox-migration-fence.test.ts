import { expect, test } from "bun:test";

import { SandboxMigrationFence } from "../src/adapters/durable-objects/sandbox-migration-fence";

const claim = { operationId: "migration-one", revision: 0 };

function fixture(initial?: unknown) {
  let stored: unknown = initial;
  let serial = Promise.resolve();
  const exits = Promise.withResolvers<void>();
  const calls = { reads: 0, destroys: 0, resets: 0 };
  const ctx = {
    storage: {
      async get() {
        calls.reads++;
        return structuredClone(stored);
      },
      async put(_key: string, value: unknown) {
        stored = structuredClone(value);
      },
      async sync() {},
    },
    container: {
      running: true,
      monitor: () => exits.promise,
      async destroy() {
        calls.destroys++;
      },
    },
    blockConcurrencyWhile<T>(action: () => Promise<T>): Promise<T> {
      const pending = serial.then(action);
      serial = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    abort(message?: string): never {
      calls.resets++;
      throw new Error(message);
    },
  };
  return { ctx, calls, exits, create: () => new SandboxMigrationFence(ctx) };
}

async function acquired(f: ReturnType<typeof fixture>) {
  await expect(f.create().begin(claim)).rejects.toThrow("reacquire the Durable Object stub");
  return f.create();
}

test("a claim flushes before resetting and survives the new actor", async () => {
  const f = fixture();
  const flush = Promise.withResolvers<void>();
  const flushing = Promise.withResolvers<void>();
  f.ctx.storage.sync = async () => {
    flushing.resolve();
    await flush.promise;
  };
  const before = f.create();
  const pending = before.begin(claim).catch((error: unknown) => error);
  await flushing.promise;
  expect(f.calls.resets).toBe(0);
  await expect(before.assertOpen()).rejects.toThrow("fence is held");
  expect((await before.inspect()).resetRequired).toBe(true);
  flush.resolve();
  expect(await pending).toBeInstanceOf(Error);
  const after = f.create();
  expect(await after.inspect()).toMatchObject({
    ...claim,
    resetRequired: false,
    stoppedVerified: false,
  });
  expect(await after.begin(claim)).toMatchObject(claim);
  expect(f.calls.resets).toBe(1);
  await expect(before.stop(claim)).rejects.toThrow("requires an actor reset");
});

test("only one concurrent owner wins, and failed claims cannot open access", async () => {
  const f = fixture();
  const fence = f.create();
  const results = await Promise.allSettled([
    fence.begin(claim),
    fence.begin({ ...claim, operationId: "other-owner" }),
  ]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect((await fence.inspect()).operationId).toBe(claim.operationId);
  expect(f.calls.resets).toBe(1);
  await expect(fence.assertOpen()).rejects.toThrow("fence is held");
});

test("stop waits for physical exit, coalesces callers, and excludes premature release", async () => {
  const f = fixture();
  const fence = await acquired(f);
  const destroying = Promise.withResolvers<void>();
  f.ctx.container.destroy = async () => {
    f.calls.destroys++;
    destroying.resolve();
  };
  const first = fence.stop(claim);
  const second = fence.stop(claim);
  await destroying.promise;
  expect((await fence.inspect()).stopping).toBe(true);
  f.ctx.container.running = false;
  await expect(fence.release(claim)).rejects.toThrow("before physical stop completes");
  f.exits.reject(new Error("Container exited with unexpected exit code: 137"));
  expect(await first).toMatchObject({ stoppedVerified: true, stopping: false });
  await second;
  expect(f.calls.destroys).toBe(1);
  await fence.release(claim);
  await fence.assertOpen();
});

test("a monitor outcome alone cannot qualify a running container", async () => {
  const f = fixture();
  const fence = await acquired(f);
  f.exits.resolve();
  await expect(fence.stop(claim)).rejects.toThrow("has not physically stopped");
  await expect(fence.release(claim)).rejects.toThrow("before physical stop completes");
  await expect(fence.assertOpen()).rejects.toThrow("fence is held");
});

test("failed destruction retains exclusion until a verified retry", async () => {
  const f = fixture();
  const fence = await acquired(f);
  f.ctx.container.destroy = async () => {
    throw new Error("destroy failed");
  };
  await expect(fence.stop(claim)).rejects.toThrow("destroy failed");
  f.ctx.container.running = false;
  await expect(fence.release(claim)).rejects.toThrow("before physical stop completes");
  await fence.stop(claim);
  expect(await fence.release(claim)).toMatchObject({ revision: 1, operationId: null });
});

test("a caller timeout keeps a pending physical stop excluded", async () => {
  const f = fixture();
  const fence = await acquired(f);
  await expect(fence.stop(claim)).rejects.toThrow("Timed out stopping");
  expect((await fence.inspect()).stopping).toBe(true);
  f.ctx.container.running = false;
  await expect(fence.release(claim)).rejects.toThrow("before physical stop completes");
  f.exits.resolve();
  await fence.stop(claim);
  await fence.release(claim);
  await fence.assertOpen();
}, 35_000);

test("unavailable physical state cannot qualify release", async () => {
  const f = fixture();
  const { container: _container, ...ctx } = f.ctx;
  await expect(new SandboxMigrationFence(ctx).begin(claim)).rejects.toThrow("reacquire");
  const fence = new SandboxMigrationFence(ctx);
  await expect(fence.stop(claim)).rejects.toThrow("state is unavailable");
  await expect(fence.release(claim)).rejects.toThrow("before physical stop completes");
});

test("a failed claim flush never resets or opens the current actor", async () => {
  const f = fixture();
  const fence = f.create();
  f.ctx.storage.sync = async () => {
    throw new Error("flush failed");
  };
  await expect(fence.begin(claim)).rejects.toThrow("flush failed");
  expect(f.calls.resets).toBe(0);
  await expect(fence.assertOpen()).rejects.toThrow("fence is held");
  f.ctx.storage.sync = async () => {};
  await expect(fence.begin(claim)).rejects.toThrow("reacquire");
  expect(f.calls.resets).toBe(1);
});

test("release is idempotent and stale claims cannot fence a later lifetime", async () => {
  const f = fixture();
  const fence = await acquired(f);
  f.ctx.container.running = false;
  await fence.stop(claim);
  await expect(fence.release({ ...claim, operationId: "other-owner" })).rejects.toThrow(
    "another operation",
  );
  await fence.release(claim);
  expect(await fence.release(claim)).toMatchObject({ revision: 1, operationId: null });
  const fresh = f.create();
  await expect(fresh.begin(claim)).rejects.toThrow("Stale");
  await fresh.assertOpen();
  const next = { revision: 1, operationId: "migration-two" };
  await expect(fresh.begin(next)).rejects.toThrow("reacquire");
  const nextActor = f.create();
  await expect(nextActor.release(claim)).rejects.toThrow("another operation");
  expect(await nextActor.inspect()).toMatchObject(next);
});

test("failed release persistence keeps the current actor closed", async () => {
  const f = fixture();
  const fence = await acquired(f);
  f.ctx.container.running = false;
  await fence.stop(claim);
  f.ctx.storage.sync = async () => {
    throw new Error("flush failed");
  };
  await expect(fence.release(claim)).rejects.toThrow("flush failed");
  await expect(fence.assertOpen()).rejects.toThrow("fence is held");
});

test("corrupt storage and invalid revisions fail closed", async () => {
  const corrupt = fixture({ revision: -1, active: null, releasedOperationId: null }).create();
  await expect(corrupt.assertOpen()).rejects.toThrow("Invalid persisted");
  const f = fixture();
  for (const revision of [-1, 0.5, Number.NaN]) {
    await expect(f.create().begin({ ...claim, revision })).rejects.toThrow("Invalid");
  }
  expect(f.calls.resets).toBe(0);
});
