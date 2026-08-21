import { describe, expect, test } from "bun:test";

import { findVirtualizedStartIndex } from "../src/shared/ui/session-events/drawer-virtualization";

function findVirtualizedStartIndexLinear(
  offsets: readonly number[],
  scrollTop: number,
  overscan: number,
): number {
  const firstVisible = offsets.findIndex((offset, index) => {
    const nextOffset = offsets[index + 1] ?? Number.POSITIVE_INFINITY;
    return nextOffset >= scrollTop && offset <= scrollTop;
  });

  return Math.max(0, firstVisible === -1 ? 0 : firstVisible - overscan);
}

describe("session event drawer virtualization", () => {
  test("preserves row-boundary and overscan behavior", () => {
    const offsets = [0, 70, 140, 210, 280, 350, 420, 490, 560, 630];

    expect(findVirtualizedStartIndex([], 200, 2)).toBe(0);
    expect(findVirtualizedStartIndex(offsets, 0, 2)).toBe(0);
    expect(findVirtualizedStartIndex(offsets, 210, 2)).toBe(0);
    expect(findVirtualizedStartIndex(offsets, 211, 2)).toBe(1);
    expect(findVirtualizedStartIndex(offsets, 280, 2)).toBe(1);
    expect(findVirtualizedStartIndex(offsets, 281, 2)).toBe(2);
    expect(findVirtualizedStartIndex(offsets, 1_000, 2)).toBe(7);
  });

  test("matches the previous linear scan for mixed row heights", () => {
    const offsets: number[] = [];
    let currentOffset = 0;

    for (let index = 0; index < 1_000; index += 1) {
      offsets.push(currentOffset);
      currentOffset += index % 9 === 0 ? 210 : 70;
    }

    for (let scrollTop = -50; scrollTop <= currentOffset + 300; scrollTop += 17) {
      expect(findVirtualizedStartIndex(offsets, scrollTop, 6)).toBe(
        findVirtualizedStartIndexLinear(offsets, scrollTop, 6),
      );
    }
  });
});
