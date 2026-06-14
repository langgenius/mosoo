import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App settings boundary", () => {
  test("does not expose Organization-owned settings as App console settings", () => {
    const routeRegistry = readSource("../src/app/route-registry.tsx");
    const settingsNav = readSource("../src/routes/settings/settings-nav.tsx");

    expect(routeRegistry).not.toContain("organization-general-tab");
    expect(routeRegistry).not.toContain("OrganizationGeneralTab");
    expect(routeRegistry).not.toContain('path: "general"');
    expect(settingsNav).not.toContain('label: "Organization"');
    expect(settingsNav).not.toContain('path: "/settings/general"');
    expect(settingsNav).not.toContain("ownerOnly");
    expect(settingsNav).not.toContain("viewerRole");
  });

  test("keeps Settings to account controls and App usage only", () => {
    const routeRegistry = readSource("../src/app/route-registry.tsx");
    const settingsNav = readSource("../src/routes/settings/settings-nav.tsx");

    expect(settingsNav).toContain('label: "Profile"');
    expect(settingsNav).toContain('label: "API tokens"');
    expect(settingsNav).toContain('label: "App usage"');
    expect(settingsNav).toContain('path: "/cost"');
    expect(routeRegistry).toContain('{ element: <SettingsUsage />, path: "usage" }');
    expect(routeRegistry).toContain('{ element: <Navigate to="/cost" replace />, path: "cost" }');
    expect(routeRegistry).toContain(
      '{ element: protectedRoute(<Navigate to="/cost" replace />), path: "/usage" }',
    );
  });

  test("uses Agent API Endpoint wording for API tokens and API reference help", () => {
    const accessTokens = readSource("../src/routes/settings/access-tokens-tab.tsx");
    const helpDocs = readSource("../src/shared/config/help-docs.ts");
    const combinedSource = `${accessTokens}\n${helpDocs}`;

    expect(accessTokens).toContain(
      "Create API tokens to call Agent API endpoints. Requests are tied to your account.",
    );
    expect(helpDocs).toContain('title: "Create a Thread for an Agent API Endpoint"');
    expect(helpDocs).toContain('title: "List Threads for an Agent API Endpoint"');
    expect(combinedSource.toLowerCase()).not.toContain("published agent");
  });

  test("does not expose Web organization mutation clients", () => {
    const organizationApiIndex = readSource("../src/domains/organization/api/index.ts");

    expect(
      existsSync(
        new URL("../src/domains/organization/api/organization-catalog-client.ts", import.meta.url),
      ),
    ).toBe(false);
    expect(organizationApiIndex.trim()).toBe('export type * from "./organization-types";');
  });

  test("keeps Settings entry in the account menu without adding it to primary App nav", () => {
    const accountMenu = readSource("../src/app/account-menu.tsx");
    const primaryNav = readSource("../src/app/navigation.tsx");

    expect(accountMenu).toContain('to="/settings"');
    expect(primaryNav).not.toContain('label: "Settings"');
  });
});
