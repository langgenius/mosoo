import { describe, expect, test } from "bun:test";

import { createLeaseOwnershipRenewal } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/lease-ownership-renewal";

describe("lease ownership renewal", () => {
  test("serializes concurrent renewals and latches ownership loss", async () => {
    const result = Promise.withResolvers<boolean>();
    let renewalCalls = 0;
    let destructiveCalls = 0;
    const requireOwnership = createLeaseOwnershipRenewal(() => {
      renewalCalls += 1;
      return result.promise;
    }, "lost ownership");

    const heartbeat = requireOwnership();
    const destructive = requireOwnership().then(() => {
      destructiveCalls += 1;
    });
    expect(renewalCalls).toBe(1);

    const settled = Promise.allSettled([heartbeat, destructive]);
    result.resolve(false);
    expect(await settled).toEqual([
      { reason: expect.objectContaining({ message: "lost ownership" }), status: "rejected" },
      { reason: expect.objectContaining({ message: "lost ownership" }), status: "rejected" },
    ]);
    await expect(requireOwnership()).rejects.toThrow("lost ownership");
    expect(renewalCalls).toBe(1);
    expect(destructiveCalls).toBe(0);
  });

  test("latches an uncertain renewal failure", async () => {
    const cause = new Error("renewal failed");
    let renewalCalls = 0;
    const requireOwnership = createLeaseOwnershipRenewal(async () => {
      renewalCalls += 1;
      throw cause;
    }, "lost ownership");

    await expect(requireOwnership()).rejects.toMatchObject({ cause, message: "lost ownership" });
    await expect(requireOwnership()).rejects.toMatchObject({ cause, message: "lost ownership" });
    expect(renewalCalls).toBe(1);
  });
});
