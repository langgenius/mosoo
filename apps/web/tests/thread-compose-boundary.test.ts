import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Thread compose boundary", () => {
  test("keeps the composer scoped to one Agent in the active App", () => {
    const source = readSource("../src/routes/threads/compose/new-dialog.tsx");

    expect(source).toContain("Start a Thread for one Agent.");
    expect(source).toContain("This Agent is not available in this App.");
    expect(source).toContain("Publish this Agent before starting a Thread.");

    expect(source.toLowerCase()).not.toContain("published agent");
    expect(source).not.toContain("current organization");
    expect(source).not.toContain("assigning a Thread");
  });
});
