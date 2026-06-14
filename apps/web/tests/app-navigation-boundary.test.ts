import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App navigation boundary", () => {
  test("puts App Overview before Agent-first surfaces", () => {
    const source = readSource("../src/app/navigation.tsx");
    const overviewIndex = source.indexOf('label: "Overview"');
    const threadsIndex = source.indexOf('label: "Threads"');
    const agentsIndex = source.indexOf('label: "Agents"');
    const channelsIndex = source.indexOf('label: "Channels"');

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(channelsIndex).toBeGreaterThan(-1);
    expect(overviewIndex).toBeLessThan(threadsIndex);
    expect(overviewIndex).toBeLessThan(agentsIndex);
    expect(agentsIndex).toBeLessThan(channelsIndex);
    expect(source).toContain('path: "/"');
    expect(source).toContain('path: "/channels"');
    expect(source).not.toContain('label: "Members"');
  });

  test("keeps the shell scoped to the active App instead of Organization controls", () => {
    const source = readSource("../src/app/app-shell.tsx");

    expect(source).toContain("AppScopePill");
    expect(source).not.toContain("OrganizationSwitcher");
    expect(source).not.toContain("New agent");
  });
});
