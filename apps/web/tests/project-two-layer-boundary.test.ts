import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Two-layer console boundary", () => {
  test("Org-layer routes render in the Org shell, not the Project sidebar", () => {
    const routeRegistry = readSource("../src/app/route-registry.tsx");

    expect(routeRegistry).toContain('orgProtectedRoute(<ProjectsList />), path: "/projects"');
    expect(routeRegistry).toContain('orgProtectedRoute(<OrgSettings />), path: "/org/settings"');
  });

  test("the shell picks the Org vs Project layout by route", () => {
    const guards = readSource("../src/app/route-guards.tsx");
    const shell = readSource("../src/app/app-shell.tsx");

    expect(guards).toContain('shell?: "project" | "org"');
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

  test("Org shell owns the Projects title in the top band", () => {
    const shell = readSource("../src/app/app-shell.tsx");
    const projectsList = readSource("../src/routes/projects/projects-list.route.tsx");

    expect(shell).toContain('titleKey: "pageTitle.projects"');
    expect(shell).toContain("getOrgHeaderTitle");
    expect(projectsList).not.toContain(">Projects</h1>");
  });

  test("Org shell owns the Org settings title in the top band", () => {
    const shell = readSource("../src/app/app-shell.tsx");
    const orgSettings = readSource("../src/routes/org/org-settings.route.tsx");

    expect(shell).toContain('titleKey: "pageTitle.orgSettings"');
    expect(orgSettings).not.toContain("<PageHeader");
    expect(orgSettings).not.toContain('title="Org settings"');
  });

  test("New project creation is wired to the createProject mutation", () => {
    const projectsList = readSource("../src/routes/projects/projects-list.route.tsx");

    expect(projectsList).toContain("createProject");
    expect(projectsList).toContain('t("projects.new")');
    expect(projectsList).toContain("ProjectIdBadge");
    expect(projectsList).not.toContain("coming soon");
  });
});
