export function findVirtualizedStartIndex(
  offsets: readonly number[],
  scrollTop: number,
  overscan: number,
): number {
  if (offsets.length === 0) {
    return 0;
  }

  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const nextOffset = offsets[middle + 1] ?? Number.POSITIVE_INFINITY;

    if (nextOffset >= scrollTop) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return Math.max(0, low - overscan);
}
