import { mock } from "bun:test";
import assert from "node:assert/strict";

const started = Promise.withResolvers<void>();
const completion = Promise.withResolvers<void>();
let calls = 0;

void mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown) {}
  },
}));
void mock.module("../../src/modules/runtime/infrastructure/driver-instance/do", () => ({
  DriverInstance: class {
    async alarm(): Promise<void> {
      calls += 1;
      if (calls > 1) {
        throw new Error("injected finalization failure");
      }
      started.resolve();
      await completion.promise;
    }
  },
}));

const { DriverConnection } =
  await import("../../src/adapters/durable-objects/driver-connection.do");
const connection = new DriverConnection({} as never, {} as never);
let settled = false;
const pending = connection.alarm().then(() => {
  settled = true;
});

await started.promise;
assert.equal(settled, false);
completion.resolve();
await pending;
assert.equal(calls, 1);
await assert.rejects(connection.alarm(), /injected finalization failure/);
assert.equal(calls, 2);
