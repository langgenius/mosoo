import { describe, expect, test } from "bun:test";

import { createPlatformId, isPlatformId, parsePlatformId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

describe("platform id", () => {
  test("creates unique monotonic uppercase ULIDs in the same millisecond", () => {
    const ids = [
      createPlatformId(1_700_000_000_000),
      createPlatformId(1_700_000_000_000),
      createPlatformId(1_700_000_000_000),
    ];

    expect(ids.every(isPlatformId)).toBe(true);
    expect(ids).toEqual(ids.toSorted());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps ordering when an explicit timestamp regresses", () => {
    const first = createPlatformId(1_700_000_000_002);
    const regressive = createPlatformId(1_700_000_000_001);

    expect(regressive > first).toBe(true);
  });

  test("normalizes lowercase and mixedcase input to canonical uppercase", () => {
    expect(parsePlatformId("01j00000000000000000000001")).toBe(PLATFORM_ID_FIXTURES.account);
    expect(parsePlatformId("01J0000000000000000000000a")).toBe("01J0000000000000000000000A");
  });

  test("only treats canonical uppercase IDs as platform IDs", () => {
    expect(isPlatformId(PLATFORM_ID_FIXTURES.agent)).toBe(true);
    expect(isPlatformId("01j00000000000000000000001")).toBe(false);
  });

  test("rejects malformed IDs with the caller label", () => {
    expect(() => parsePlatformId("agent-1", "Agent ID")).toThrow("Agent ID must be a valid ULID.");
    expect(() => parsePlatformId(1, "Agent ID")).toThrow("Agent ID must be a ULID string.");
  });
});
