import { describe, expect, test } from "bun:test";

import { SandboxHandleGuard } from "../src/adapters/durable-objects/sandbox-handle-guard";

interface SessionHandle {
  readonly id: string;
  readFile(): Promise<string>;
  startProcess(): Promise<{ getStatus(): Promise<string> }>;
}

function sessionFixture() {
  let calls = 0;
  return {
    calls: () => calls,
    value: {
      id: "synthetic-session",
      async readFile() {
        calls++;
        return this.id;
      },
      async startProcess() {
        return {
          async getStatus() {
            calls++;
            return "running";
          },
        };
      },
    },
  };
}

describe("Sandbox handles across explicit container teardown", () => {
  test("revokes old Session and nested Process handles without calling the SDK", async () => {
    const guard = new SandboxHandleGuard();
    const fixture = sessionFixture();
    const session = (await guard.capture(async () => fixture.value)) as SessionHandle;
    expect(session.id).toBe("synthetic-session");
    expect(await session.readFile()).toBe(session.id);
    const process = await session.startProcess();
    await guard.destroy(async () => undefined);
    await expect(session.readFile()).rejects.toThrow("invalidated by container teardown");
    await expect(process.getStatus()).rejects.toThrow("invalidated by container teardown");
    expect(fixture.calls()).toBe(1);
    const fresh = (await guard.capture(async () => fixture.value)) as SessionHandle;
    expect(await fresh.readFile()).toBe(fresh.id);
    expect(fixture.calls()).toBe(2);
  });

  test("late handle creation stays invalid when it began before teardown", async () => {
    const guard = new SandboxHandleGuard();
    const fixture = sessionFixture();
    const created = Promise.withResolvers<SessionHandle>();
    const pending = guard.capture(() => created.promise);
    await guard.destroy(async () => undefined);
    created.resolve(fixture.value);
    await expect(((await pending) as SessionHandle).readFile()).rejects.toThrow("invalidated");
    expect(fixture.calls()).toBe(0);
  });

  test("handles issued during overlapping destroys remain revoked after both complete", async () => {
    const guard = new SandboxHandleGuard();
    const fixture = sessionFixture();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const firstDestroy = guard.destroy(() => first.promise);
    const secondDestroy = guard.destroy(() => second.promise);
    const during = (await guard.capture(async () => fixture.value)) as SessionHandle;
    await expect(during.readFile()).rejects.toThrow("invalidated");
    first.resolve();
    await firstDestroy;
    const between = (await guard.capture(async () => fixture.value)) as SessionHandle;
    await expect(between.readFile()).rejects.toThrow("invalidated");
    second.resolve();
    await secondDestroy;
    await expect(during.readFile()).rejects.toThrow("invalidated");
    await expect(between.readFile()).rejects.toThrow("invalidated");
    expect(fixture.calls()).toBe(0);
  });

  test("failed destruction does not make old callbacks valid again", async () => {
    const guard = new SandboxHandleGuard();
    const fixture = sessionFixture();
    const session = (await guard.capture(async () => fixture.value)) as SessionHandle;
    await expect(
      guard.destroy(async () => {
        throw new Error("destroy failed");
      }),
    ).rejects.toThrow("destroy failed");
    await expect(session.readFile()).rejects.toThrow("invalidated");
    expect(fixture.calls()).toBe(0);
  });

  test("protects Process lists while preserving dates and stream resources", async () => {
    const guard = new SandboxHandleGuard();
    const date = new Date(123);
    const stream = new ReadableStream();
    const source = [{ date, stream, read: async () => "ok" }];
    const handles = (await guard.capture(async () => source)) as typeof source;
    expect(handles[0]?.date).toBe(date);
    expect(handles[0]?.stream).toBe(stream);
    await guard.destroy(async () => undefined);
    await expect(handles[0]?.read()).rejects.toThrow("invalidated");
  });
});
