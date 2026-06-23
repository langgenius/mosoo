import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Two-layer console boundary", () => {
  test("Org-layer routes render in the Org shell, not the App sidebar", () => {
    const routeRegistry = readSource("../src/app/route-registry.tsx");

    expect(routeRegistry).toContain('orgProtectedRoute(<AppsList />), path: "/apps"');
    expect(routeRegistry).toContain('orgProtectedRoute(<OrgSettings />), path: "/org/settings"');
  });

  test("the shell picks the Org vs App layout by route", () => {
    const guards = readSource("../src/app/route-guards.tsx");
    const shell = readSource("../src/app/app-shell.tsx");

    expect(guards).toContain('shell?: "app" | "org"');
    expect(guards).toContain("OrgLayout");
    expect(shell).toContain("export function OrgLayout");
    expect(shell).toContain("OrgNavigation");
  });

  test("Org shell uses the shared lower-left account navigation", () => {
    const shell = readSource("../src/app/app-shell.tsx");

    expect(shell).toContain("ConsoleSidebarFooter");
    expect(shell).toContain("<ConsoleSidebarFooter collapsed={false} />");
    expect(shell).not.toContain('placement="topbar"');
    expect(shell).not.toContain("<GithubLink />");
  });

  test("Org shell owns the Apps title in the top band", () => {
    const shell = readSource("../src/app/app-shell.tsx");
    const appsList = readSource("../src/routes/apps/apps-list.route.tsx");

    expect(shell).toContain('title: "Apps"');
    expect(shell).toContain("getOrgHeaderTitle");
    expect(appsList).not.toContain(">Apps</h1>");
  });

  test("Org shell owns the Org settings title in the top band", () => {
    const shell = readSource("../src/app/app-shell.tsx");
    const orgSettings = readSource("../src/routes/org/org-settings.route.tsx");

    expect(shell).toContain('path: "/org/settings", title: "Org settings"');
    expect(orgSettings).not.toContain("<PageHeader");
    expect(orgSettings).not.toContain('title="Org settings"');
  });

  test("New app creation is wired to the createApp mutation", () => {
    const appsList = readSource("../src/routes/apps/apps-list.route.tsx");

    expect(appsList).toContain("createApp");
    expect(appsList).toContain("New app");
    expect(appsList).toContain("AppIdBadge");
    expect(appsList).not.toContain("coming soon");
  });
});
