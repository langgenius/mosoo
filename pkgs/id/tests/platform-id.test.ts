import { describe, expect, test } from "bun:test";

import {
  comparePlatformIds,
  createPlatformId,
  assertPlatformId,
  isPlatformId,
  normalizePlatformId,
  parsePlatformId,
  readPlatformIdTime,
  sortPlatformIds,
} from "@mosoo/id";
import { MALFORMED_PLATFORM_ID_FIXTURES, PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

const ULID_TIME_MAX = 281_474_976_710_655;

describe("platform id", () => {
  test("creates IDs at the lower ULID timestamp boundary", () => {
    const id = createPlatformId(0);

    expect(isPlatformId(id)).toBe(true);
    expect(readPlatformIdTime(id)).toBe(0);
  });

  test("creates monotonic uppercase ULIDs in the same millisecond", () => {
    const ids = [
      createPlatformId(1_700_000_000_000),
      createPlatformId(1_700_000_000_000),
      createPlatformId(1_700_000_000_000),
    ];

    expect(ids.every(isPlatformId)).toBe(true);
    expect(ids).toEqual(sortPlatformIds(ids));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("promotes regressive explicit timestamps to preserve monotonic ordering", () => {
    const first = createPlatformId(1_700_000_000_002);
    const regressive = createPlatformId(1_700_000_000_001);

    expect(readPlatformIdTime(first)).toBe(1_700_000_000_002);
    expect(readPlatformIdTime(regressive)).toBe(1_700_000_000_002);
    expect(comparePlatformIds(first, regressive)).toBeLessThan(0);
  });

  test("normalizes lowercase and mixedcase input to canonical uppercase", () => {
    expect(normalizePlatformId("01j00000000000000000000001")).toBe(PLATFORM_ID_FIXTURES.account);
    expect(parsePlatformId("01J0000000000000000000000a")).toBe("01J0000000000000000000000A");
  });

  test("only treats canonical uppercase IDs as branded platform IDs", () => {
    expect(isPlatformId(PLATFORM_ID_FIXTURES.agent)).toBe(true);
    expect(isPlatformId("01j00000000000000000000001")).toBe(false);
    expect(() => assertPlatformId("01j00000000000000000000001")).toThrow();
  });

  test("reports malformed IDs with a caller label", () => {
    expect(() => parsePlatformId("agent-1", "Agent ID")).toThrow();
  });

  test("compares, sorts, and reads timestamps", () => {
    const early = createPlatformId(1_700_000_000_003);
    const late = createPlatformId(1_700_000_000_004);

    expect(comparePlatformIds(early, late)).toBeLessThan(0);
    expect(sortPlatformIds([late, early])).toEqual([early, late]);
    expect(readPlatformIdTime(early)).toBe(1_700_000_000_003);
  });

  test("rejects invalid explicit timestamps before generating an ID", () => {
    for (const value of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createPlatformId(value)).toThrow();
    }

    for (const value of [-1, ULID_TIME_MAX + 1]) {
      expect(() => createPlatformId(value)).toThrow();
    }
  });

  test("keeps shared fixtures valid and malformed fixtures invalid", () => {
    expect(Object.values(PLATFORM_ID_FIXTURES).every(isPlatformId)).toBe(true);

    for (const value of MALFORMED_PLATFORM_ID_FIXTURES) {
      expect(isPlatformId(value)).toBe(false);
    }
  });

  test("creates IDs at the upper ULID timestamp boundary", () => {
    const id = createPlatformId(ULID_TIME_MAX);

    expect(isPlatformId(id)).toBe(true);
    expect(readPlatformIdTime(id)).toBe(ULID_TIME_MAX);
  });
});
