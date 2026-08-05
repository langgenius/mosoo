import { describe, expect, test } from "bun:test";

import { formatCatalogCount } from "../src/routes/integrations/skills/format";

describe("formatCatalogCount", () => {
  test("keeps small counts in standard notation", () => {
    expect(formatCatalogCount(0)).toBe("0");
    expect(formatCatalogCount(999)).toBe("999");
    expect(formatCatalogCount(9_999)).toBe("9,999");
  });

  test("compacts counts from 10k with at most one fraction digit", () => {
    expect(formatCatalogCount(10_000)).toBe("10K");
    expect(formatCatalogCount(12_345)).toBe("12.3K");
    expect(formatCatalogCount(1_234_567)).toBe("1.2M");
  });

  test("uses the requested locale for compact units", () => {
    expect(formatCatalogCount(21_000)).toBe("21K");
    expect(formatCatalogCount(21_000, "zh-CN")).toBe("2.1万");
  });
});
