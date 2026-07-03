import { describe, expect, test } from "bun:test";

import { resolveDocumentTitle } from "../src/app/document-title";

describe("document title", () => {
  test("uses the current App name for App-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeAppName: "Default App",
        activeOrganizationName: "Mosoo Org",
        pathname: "/integrations/skills",
      }),
    ).toBe("Skills | Default App | Mosoo");
  });

  test("uses the current Organization name for Org-layer pages", () => {
    expect(
      resolveDocumentTitle({
        activeAppName: "Default App",
        activeOrganizationName: "Mosoo Org",
        pathname: "/apps",
      }),
    ).toBe("Apps | Mosoo Org | Mosoo");
  });

  test("keeps unauthenticated routes scoped to the product", () => {
    expect(
      resolveDocumentTitle({
        activeAppName: null,
        activeOrganizationName: null,
        pathname: "/login",
      }),
    ).toBe("Sign in | Mosoo");
  });

  test("falls back to the active App before the product name for unknown App paths", () => {
    expect(
      resolveDocumentTitle({
        activeAppName: "Default App",
        activeOrganizationName: null,
        pathname: "/unexpected",
      }),
    ).toBe("Default App | Mosoo");
  });
});
