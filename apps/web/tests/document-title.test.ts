import { describe, expect, test } from "bun:test";

import { resolveDocumentTitle } from "../src/app/document-title";
import en from "../src/shared/i18n/translations/en.json";

const pageTitles: Record<string, string> = en.pageTitle;
const t = (key: string) => pageTitles[key.replace("pageTitle.", "")] ?? key;

describe("document title", () => {
  test("uses the current Project name for Project-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: "mosoo Org",
        pathname: "/integrations/skills",
        t,
      }),
    ).toBe("Skills | Default Project | mosoo");
  });

  test("uses the current Organization name for Org-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: "mosoo Org",
        pathname: "/projects",
        t,
      }),
    ).toBe("Projects | mosoo Org | mosoo");
  });

  test("keeps unauthenticated routes scoped to the product", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: null,
        activeOrganizationName: null,
        pathname: "/login",
        t,
      }),
    ).toBe("Sign in | mosoo");
  });

  test("falls back to the active Project before the product name for unknown Project paths", () => {
    expect(
      resolveDocumentTitle({
        activeProjectName: "Default Project",
        activeOrganizationName: null,
        pathname: "/unexpected",
        t,
      }),
    ).toBe("Default Project | mosoo");
  });
});
