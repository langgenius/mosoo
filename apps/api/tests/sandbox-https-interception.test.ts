import { describe, expect, test } from "bun:test";

import { disableLocalSandboxHttpsInterception } from "../src/adapters/durable-objects/sandbox-https-interception";

describe("Sandbox HTTPS interception", () => {
  test("disables interception only for the explicit local binding", () => {
    const local = { interceptHttps: true };
    disableLocalSandboxHttpsInterception(local, "true");
    expect(local.interceptHttps).toBe(false);

    const production = { interceptHttps: true };
    disableLocalSandboxHttpsInterception(production, "false");
    expect(production.interceptHttps).toBe(true);

    const unset = { interceptHttps: true };
    disableLocalSandboxHttpsInterception(unset, undefined);
    expect(unset.interceptHttps).toBe(true);
  });
});
