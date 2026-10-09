import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const LIST_PAGE_SOURCE = readFileSync(
  new URL("../src/shared/ui/list-page.tsx", import.meta.url),
  "utf8",
);
const EMPTY_STATE_SOURCE = readFileSync(
  new URL("../src/shared/ui/empty-state.tsx", import.meta.url),
  "utf8",
);

describe("mobile console boundaries", () => {
  test("shared list empty states fill the remaining page content height", () => {
    expect(LIST_PAGE_SOURCE).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(EMPTY_STATE_SOURCE).toContain("min-h-[320px] flex-1");
  });
});
