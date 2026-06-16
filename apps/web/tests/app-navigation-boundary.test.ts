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

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(overviewIndex).toBeLessThan(threadsIndex);
    expect(overviewIndex).toBeLessThan(agentsIndex);
    expect(source).toContain('path: "/"');
    expect(source).not.toContain('label: "Members"');
  });

  test("drops the standalone Channels tab from the primary nav", () => {
    const source = readSource("../src/app/navigation.tsx");

    expect(source).not.toContain('label: "Channels"');
    expect(source).not.toContain('path: "/channels"');
  });

  test("App shell offers back-to-org, an app switcher, and a New agent action", () => {
    const source = readSource("../src/app/app-shell.tsx");

    expect(source).toContain("BackToOrgLink");
    expect(source).toContain("AppSwitcher");
    expect(source).toContain("New agent");
    expect(source).not.toContain("OrganizationSwitcher");
  });
});
