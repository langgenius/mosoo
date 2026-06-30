import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("agent publish success boundary", () => {
  test("routes Try in Mosoo through locked Threads instead of exposing a web URL", () => {
    const source = readSource("../src/routes/agent/lifecycle/publish-success-modal.tsx");

    expect(source).toContain("Try in Mosoo");
    expect(source).toContain("Start a Thread with this agent.");
    expect(source).toContain("globalThis.location.assign(distribution.threadsPath)");

    expect(source).not.toContain("Web UI");
    expect(source).not.toContain("distribution.webUrl");
    expect(source).not.toContain("Open in Chat");
    expect(source).not.toContain("onOpenChat");
  });
});
