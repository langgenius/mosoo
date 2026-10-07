import { describe, expect, test } from "bun:test";

import {
  canUseMosooAiDevelopmentBackdoor,
  isDevelopmentBackdoorLoopbackOrigin,
} from "../src/mosoo-ai-development-backdoor.policy";

describe("Mosoo development auth loopback policy", () => {
  test.each([
    "http://139.99.68.217:55173",
    "https://cloud.mosoo.ai",
    "https://localhost.example.com",
    "http://192.168.1.10:5173",
  ])("given a remote origin %s, when checking development login, then reject it", (origin) => {
    expect(isDevelopmentBackdoorLoopbackOrigin(origin)).toBe(false);
    expect(canUseMosooAiDevelopmentBackdoor("rock@mosoo.ai", origin)).toBe(false);
  });

  test.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])(
    "given a loopback origin %s, when checking development login, then admit only mosoo.ai",
    (origin) => {
      expect(isDevelopmentBackdoorLoopbackOrigin(origin)).toBe(true);
      expect(canUseMosooAiDevelopmentBackdoor("rock@mosoo.ai", origin)).toBe(true);
      expect(canUseMosooAiDevelopmentBackdoor("rock@example.com", origin)).toBe(false);
    },
  );
});
