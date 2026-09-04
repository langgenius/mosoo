import { describe, expect, test } from "bun:test";

import { loadAuthDoodles } from "../src/shared/ui/auth-scene/auth-doodles-loader";

describe("auth doodles", () => {
  test("falls back to no artwork when the deferred chunk fails", async () => {
    const doodles = await loadAuthDoodles(async () => {
      throw new Error("chunk failed");
    });

    expect(doodles.default()).toBeNull();
  });
});
