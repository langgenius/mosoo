import { describe, expect, test } from "bun:test";

import {
  canUseMosooAiDevelopmentBackdoor,
  isDevelopmentBackdoorLoopbackOrigin,
} from "../src/mosoo-ai-development-backdoor.policy";

describe("Mosoo development auth preview host policy", () => {
  test("enables the development backdoor for the current public preview origin", () => {
    expect(isDevelopmentBackdoorLoopbackOrigin("http://139.99.68.217:55173")).toBe(true);
    expect(canUseMosooAiDevelopmentBackdoor("rock@mosoo.ai", "http://139.99.68.217:55173")).toBe(
      true,
    );
  });

  test("continues to reject non-mosoo.ai accounts", () => {
    expect(canUseMosooAiDevelopmentBackdoor("rock@example.com", "http://139.99.68.217:55173")).toBe(
      false,
    );
  });
});
