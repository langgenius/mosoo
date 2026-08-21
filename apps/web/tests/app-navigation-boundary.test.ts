import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Workspace navigation boundary", () => {
  test("puts Home and API Keys before Run and optional Agent surfaces", () => {
    const source = readSource("../src/app/navigation.tsx");
    const homeIndex = source.indexOf('t("nav.home")');
    const apiKeysIndex = source.indexOf('t("nav.apiKeys")');
    const runsIndex = source.indexOf('t("nav.runs")');
    const agentsIndex = source.indexOf('t("nav.agents")');
    const environmentsIndex = source.indexOf('t("nav.environments")');

    expect(homeIndex).toBeGreaterThan(-1);
    expect(apiKeysIndex).toBeGreaterThan(homeIndex);
    expect(runsIndex).toBeGreaterThan(-1);
    expect(agentsIndex).toBeGreaterThan(-1);
    expect(environmentsIndex).toBeGreaterThan(agentsIndex);
    expect(apiKeysIndex).toBeLessThan(runsIndex);
    expect(runsIndex).toBeLessThan(agentsIndex);
    expect(source).toContain('path: "/"');
    expect(source).toContain('path: "/api-keys"');
    expect(source).not.toContain('label: "Members"');
    expect(source).not.toContain('label: "Install"');
    expect(source).not.toContain('label: "Deployments"');
  });

  test("drops the standalone Channels tab from the primary nav", () => {
    const source = readSource("../src/app/navigation.tsx");

    expect(source).not.toContain('label: "Channels"');
    expect(source).not.toContain('path: "/channels"');
  });

  test("ends primary navigation with Usage and Workspace Settings", () => {
    const source = readSource("../src/app/navigation.tsx");
    const usageIndex = source.indexOf('t("nav.usage")');
    const settingsIndex = source.indexOf('t("nav.workspaceSettings")');

    expect(usageIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(usageIndex);
    expect(source).toContain('path: "/app-settings/usage"');
    expect(source).toContain('path: "/app-settings/general"');
    expect(source).not.toContain('label: "App usage"');
  });

  test("Workspace shell offers switching and a New Run action", () => {
    const source = readSource("../src/app/app-shell.tsx");

    expect(source).toContain("BackToOrgLink");
    expect(source).toContain("AppSwitcher");
    expect(source).toContain("NewRunCta");
    expect(source).toContain('t("harnessMarketplace.newRun")');
    expect(source).not.toContain("Manage apps");
    expect(source).not.toContain("App settings");
    expect(source).not.toContain("OrganizationSwitcher");
  });
});
