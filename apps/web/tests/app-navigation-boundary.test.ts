import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App navigation boundary", () => {
  test("puts App Overview before Agent-first surfaces", () => {
    const source = readSource("../src/app/navigation.tsx");
    const overviewIndex = source.indexOf('label: "Overview"');
    const runsIndex = source.indexOf('label: "Runs"');
    const agentsIndex = source.indexOf('label: "Agents"');
    const filesIndex = source.indexOf('label: "Files"');

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(runsIndex).toBeGreaterThan(-1);
    expect(agentsIndex).toBeGreaterThan(-1);
    expect(filesIndex).toBeGreaterThan(agentsIndex);
    expect(overviewIndex).toBeLessThan(runsIndex);
    expect(overviewIndex).toBeLessThan(agentsIndex);
    expect(source).toContain('path: "/"');
    expect(source).not.toContain('label: "Members"');
    expect(source).not.toContain('label: "Install"');
    expect(source).not.toContain('label: "Deployments"');
    expect(source).toContain('path: "/files"');
  });

  test("drops the standalone Channels tab from the primary nav", () => {
    const source = readSource("../src/app/navigation.tsx");

    expect(source).not.toContain('label: "Channels"');
    expect(source).not.toContain('path: "/channels"');
  });

  test("places App Settings directly below Providers in primary App nav", () => {
    const source = readSource("../src/app/navigation.tsx");
    const providersIndex = source.indexOf('label: "Providers"');
    const settingsIndex = source.indexOf('label: "Settings"');

    expect(providersIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(providersIndex);
    expect(source).toContain('path: "/app-settings"');
    expect(source).not.toContain('label: "App usage"');
  });

  test("App shell offers back-to-org, an app switcher, and a New agent action", () => {
    const source = readSource("../src/app/app-shell.tsx");

    expect(source).toContain("BackToOrgLink");
    expect(source).toContain("AppSwitcher");
    expect(source).toContain("New agent");
    expect(source).not.toContain("Manage apps");
    expect(source).not.toContain("App settings");
    expect(source).not.toContain("OrganizationSwitcher");
  });
});
