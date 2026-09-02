import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { ProjectSummary } from "@mosoo/contracts/project";

import { resolveActiveProject } from "../src/app/session/active-project";
import { toAccountId, toOrganizationId, toProjectId } from "../src/routes/typed-id";

function projectSummary(id: string, name: string): ProjectSummary {
  return {
    createdAt: "2026-06-14T00:00:00.000Z",
    defaultEnvironmentId: null,
    id: toProjectId(id),
    name,
    organizationId: toOrganizationId("01J000000000000000000000A0"),
    ownerAccountId: toAccountId("01J000000000000000000000A1"),
  };
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Project session boundary", () => {
  test("routes directly into the only Project in the active Organization", () => {
    const project = projectSummary("01J000000000000000000000A2", "Default Project");

    expect(resolveActiveProject([project])).toBe(project);
  });

  test("fails closed when an active Project cannot be proven from the Project list", () => {
    const firstProject = projectSummary("01J000000000000000000000A3", "First Project");
    const secondProject = projectSummary("01J000000000000000000000A4", "Second Project");

    expect(resolveActiveProject([])).toBeNull();
    // Multiple Projects with no selection routes to the Org-layer Projects list.
    expect(resolveActiveProject([firstProject, secondProject])).toBeNull();
  });

  test("honors an explicit Project selection when switching Projects", () => {
    const firstProject = projectSummary("01J000000000000000000000A5", "First Project");
    const secondProject = projectSummary("01J000000000000000000000A6", "Second Project");

    expect(resolveActiveProject([firstProject, secondProject], secondProject.id)).toBe(
      secondProject,
    );
    // A stale selection that no longer exists does not pin a wrong Project.
    expect(
      resolveActiveProject([firstProject, secondProject], "01J000000000000000000000A7"),
    ).toBeNull();
  });

  test("does not derive active Project by Project list order", () => {
    const source = readSource("../src/app/session/session-context.tsx");

    expect(source).toContain("resolveActiveProject(projects, selectedProjectId)");
    expect(source).not.toContain("projects[0]");
  });
});
