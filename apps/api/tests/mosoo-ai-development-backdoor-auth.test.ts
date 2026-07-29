import { describe, expect, test } from "bun:test";

import { isAuthorizedMosooAiDevelopmentBackdoorRequest } from "../src/modules/auth/infrastructure/mosoo-ai-development-backdoor";

describe("Mosoo.ai development backdoor authorization", () => {
  test("keeps loopback development behavior when no performance token is configured", async () => {
    expect(await isAuthorizedMosooAiDevelopmentBackdoorRequest(undefined, null)).toBe(true);
  });

  test("requires the protected performance staging token", async () => {
    const expectedToken = "expected-performance-token";

    expect(
      await isAuthorizedMosooAiDevelopmentBackdoorRequest(
        new Request("https://example.com"),
        expectedToken,
      ),
    ).toBe(false);
    expect(
      await isAuthorizedMosooAiDevelopmentBackdoorRequest(
        new Request("https://example.com", {
          headers: { "x-mosoo-perf-auth": "wrong-token" },
        }),
        expectedToken,
      ),
    ).toBe(false);
    expect(
      await isAuthorizedMosooAiDevelopmentBackdoorRequest(
        new Request("https://example.com", {
          headers: { "x-mosoo-perf-auth": expectedToken },
        }),
        expectedToken,
      ),
    ).toBe(true);
  });
});
