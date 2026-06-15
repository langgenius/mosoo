import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { AppSummary } from "@mosoo/contracts/app";

import { resolveActiveApp } from "../src/app/session/active-app";
import { toAccountId, toOrganizationId, toAppId } from "../src/routes/typed-id";

function appSummary(id: string, name: string): AppSummary {
  return {
    createdAt: "2026-06-14T00:00:00.000Z",
    defaultEnvironmentId: null,
    id: toAppId(id),
    name,
    organizationId: toOrganizationId("01J000000000000000000000A0"),
    ownerAccountId: toAccountId("01J000000000000000000000A1"),
    slug: name.toLowerCase(),
  };
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App session boundary", () => {
  test("routes directly into the only App in the active Organization", () => {
    const app = appSummary("01J000000000000000000000A2", "Default App");

    expect(resolveActiveApp([app])).toBe(app);
  });

  test("fails closed when an active App cannot be proven from the App list", () => {
    const firstApp = appSummary("01J000000000000000000000A3", "First App");
    const secondApp = appSummary("01J000000000000000000000A4", "Second App");

    expect(resolveActiveApp([])).toBeNull();
    // Multiple Apps with no selection routes to the Org-layer Apps list.
    expect(resolveActiveApp([firstApp, secondApp])).toBeNull();
  });

  test("honors an explicit App selection when switching Apps", () => {
    const firstApp = appSummary("01J000000000000000000000A5", "First App");
    const secondApp = appSummary("01J000000000000000000000A6", "Second App");

    expect(resolveActiveApp([firstApp, secondApp], secondApp.id)).toBe(secondApp);
    // A stale selection that no longer exists does not pin a wrong App.
    expect(resolveActiveApp([firstApp, secondApp], "01J000000000000000000000A7")).toBeNull();
  });

  test("does not derive active App by App list order", () => {
    const source = readSource("../src/app/session/session-context.tsx");

    expect(source).toContain("resolveActiveApp(apps, selectedAppId)");
    expect(source).not.toContain("apps[0]");
  });
});
