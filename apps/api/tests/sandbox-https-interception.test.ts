import { describe, expect, test } from "bun:test";

import { configureSandboxHttpsInterception } from "../src/adapters/durable-objects/sandbox-https-interception";

describe("Sandbox HTTPS interception", () => {
  test("pins production on and preserves the explicit local CA escape hatch", () => {
    const local = { interceptHttps: true };
    configureSandboxHttpsInterception(local, "true");
    expect(local.interceptHttps).toBe(false);

    const production = { interceptHttps: false };
    configureSandboxHttpsInterception(production, "false");
    expect(production.interceptHttps).toBe(true);

    const unset = { interceptHttps: false };
    configureSandboxHttpsInterception(unset, undefined);
    expect(unset.interceptHttps).toBe(true);
  });
});
