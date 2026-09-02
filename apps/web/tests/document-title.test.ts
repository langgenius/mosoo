import { describe, expect, test } from "bun:test";

import { resolveDocumentTitle } from "../src/app/document-title";

describe("document title", () => {
  test("uses the current Project name for Project-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: "mosoo Org",
        pathname: "/integrations/skills",
      }),
    ).toBe("Skills | Default Project | mosoo");
  });

  test("uses the current Organization name for Org-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: "mosoo Org",
        pathname: "/projects",
      }),
    ).toBe("Projects | mosoo Org | mosoo");
  });

  test("keeps unauthenticated routes scoped to the product", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: null,
        activeOrganizationName: null,
        pathname: "/login",
      }),
    ).toBe("Sign in | mosoo");
  });

  test("falls back to the active Project before the product name for unknown Project paths", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: null,
        pathname: "/unexpected",
      }),
    ).toBe("Default Project | mosoo");
  });
});
