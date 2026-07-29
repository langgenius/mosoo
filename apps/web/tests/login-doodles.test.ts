import { describe, expect, test } from "bun:test";

import { loadLoginDoodles } from "../src/routes/login/login-doodles-loader";

describe("login doodles", () => {
  test("falls back to no artwork when the deferred chunk fails", async () => {
    const doodles = await loadLoginDoodles(async () => {
      throw new Error("chunk failed");
    });

    expect(doodles.default()).toBeNull();
  });
});
