import { describe, expect, test } from "bun:test";

import {
  assertNonProductionBaseUrl,
  createSmokeThreadBody,
} from "./public-api-nonproduction-smoke";

describe("Public API non-production smoke", () => {
  test("normalizes a deployed non-production API URL", () => {
    expect(assertNonProductionBaseUrl("https://staging.example.com/api/v1/").href).toBe(
      "https://staging.example.com/api/v1",
    );
  });

  test("refuses every Mosoo production host", () => {
    for (const host of ["cloud.mosoo.ai", "mosoo.ai", "try.mosoo.ai"]) {
      expect(() => assertNonProductionBaseUrl(`https://${host}/api/v1`)).toThrow(
        "Refusing to run Public API smoke against production host",
      );
    }
  });

  test("builds the high-usage runtime case without changing the public request shape", () => {
    const inputText = "x".repeat(1_430);

    expect(createSmokeThreadBody("contract-smoke", inputText)).toEqual({
      input: {
        content: [{ text: inputText, type: "text" }],
        type: "user.message",
      },
      userId: "contract-smoke",
    });
  });
});
