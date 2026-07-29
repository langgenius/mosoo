import { describe, expect, test } from "bun:test";

import { configureSandboxHttpsInterception } from "../src/adapters/durable-objects/sandbox-https-interception";

describe("Sandbox HTTPS interception", () => {
  test("keeps the platform hook and Sandbox startup flag aligned", () => {
    const sandbox = {
      envVars: { EXISTING: "kept" },
      interceptHttps: false,
    };

    configureSandboxHttpsInterception(sandbox, true);
    expect(sandbox.interceptHttps).toBe(true);
    expect(sandbox.envVars).toEqual({ EXISTING: "kept", SANDBOX_INTERCEPT_HTTPS: "1" });

    configureSandboxHttpsInterception(sandbox, false);
    expect(sandbox.interceptHttps).toBe(false);
    expect(sandbox.envVars).toEqual({ EXISTING: "kept" });
  });
});
