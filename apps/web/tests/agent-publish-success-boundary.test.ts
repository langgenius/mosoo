import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("agent publish success boundary", () => {
  test("keeps the Thread entry in the modal body without the footer Try CTA", () => {
    const source = readSource("../src/routes/agent/lifecycle/publish-success-modal.tsx");

    expect(source.match(/Try in Mosoo/g)?.length ?? 0).toBe(1);
    expect(source).toContain("Try in Mosoo");
    expect(source).toContain("Start a Thread with this agent.");
    expect(source).toContain("globalThis.location.assign(distribution.threadsPath)");

    expect(source).not.toContain("Web UI");
    expect(source).not.toContain("distribution.webUrl");
    expect(source).not.toContain("Open in Chat");
    expect(source).not.toContain("onOpenChat");
  });
});
