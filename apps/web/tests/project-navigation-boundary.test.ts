import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Project navigation boundary", () => {
  test("renders a generic not-found page for unknown routes", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).toContain("<NotFoundPage />");
    expect(source).toContain('path: "*"');
  });

  test("puts Project Overview before Agent-first surfaces", () => {
    const source = readSource("../src/app/navigation.tsx");
    const overviewIndex = source.indexOf('t("nav.overview")');
    const runsIndex = source.indexOf('t("nav.runs")');
    const agentsIndex = source.indexOf('t("nav.agents")');
    const filesIndex = source.indexOf('t("nav.files")');

    expect(overviewIndex).toBeGreaterThan(-1);
    expect(runsIndex).toBeGreaterThan(-1);
    expect(agentsIndex).toBeGreaterThan(-1);
    expect(filesIndex).toBeGreaterThan(agentsIndex);
    expect(overviewIndex).toBeLessThan(runsIndex);
    expect(overviewIndex).toBeLessThan(agentsIndex);
    expect(source).toContain('path: "/"');
    expect(source).not.toContain('label: "Members"');
    expect(source).not.toContain('label: "Install"');
    expect(source).toContain('path: "/files"');
  });

  test("places Project Settings after Providers in the Project nav", () => {
    const source = readSource("../src/app/navigation.tsx");
    const providersIndex = source.indexOf('t("nav.providers")');
    const settingsIndex = source.indexOf('t("nav.settings")');

    expect(providersIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(providersIndex);
    expect(source).toContain('path: "/project-settings"');
    expect(source).not.toContain('label: "Project usage"');
  });

  test("Project shell offers back-to-org, a Project switcher, and a New agent action", () => {
    const source = readSource("../src/app/app-shell.tsx");

    expect(source).toContain("BackToOrgLink");
    expect(source).toContain("ProjectSwitcher");
    expect(source).toContain('t("agent.create")');
    expect(source).not.toContain("Manage projects");
    expect(source).not.toContain("Project settings");
    expect(source).not.toContain("OrganizationSwitcher");
  });
});
