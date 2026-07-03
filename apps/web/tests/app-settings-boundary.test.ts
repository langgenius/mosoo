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
    expect(settingsNav).not.toContain('label: "Organization"');
    expect(settingsNav).not.toContain('path: "/settings/general"');
    expect(settingsNav).not.toContain("ownerOnly");
    expect(settingsNav).not.toContain("viewerRole");
  });

  test("keeps account Settings to account controls", () => {
    const routeRegistry = readSource("../src/app/route-registry.tsx");
    const settingsNav = readSource("../src/routes/settings/settings-nav.tsx");

    expect(settingsNav).toContain('label: "Profile"');
    expect(settingsNav).toContain('label: "API tokens"');
    expect(settingsNav).not.toContain('label: "App usage"');
    expect(settingsNav).not.toContain('label: "App"');
    expect(settingsNav).not.toContain('path: "/settings/usage"');
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/app-settings/usage" replace />, path: "usage" }',
    );
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/app-settings/usage" replace />, path: "cost" }',
    );
    expect(routeRegistry).not.toContain("<SettingsUsage />");
  });

  test("keeps App settings in the App sidebar as Settings", () => {
    const settingsNav = readSource("../src/routes/settings/settings-nav.tsx");
    const appSettingsNav = readSource("../src/routes/app-settings/app-settings-nav.tsx");
    const routeRegistry = readSource("../src/app/route-registry.tsx");
    const primaryNav = readSource("../src/app/navigation.tsx");

    expect(settingsNav).toContain('label: "Account"');
    expect(settingsNav).not.toContain('label: "General"');
    expect(settingsNav).not.toContain('path: "/settings/app"');
    expect(primaryNav).toContain('label: "Settings"');
    expect(primaryNav).not.toContain('label: "App usage"');
    expect(primaryNav).toContain('path: "/app-settings"');
    expect(appSettingsNav).toContain('label: "General"');
    expect(appSettingsNav).toContain('label: "App usage"');
    expect(appSettingsNav).toContain('path: "/app-settings/general"');
    expect(appSettingsNav).toContain('path: "/app-settings/usage"');
    expect(routeRegistry).toContain(
      'async () => import("../routes/app-settings/app-settings.route")',
    );
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/app-settings/general" replace />, index: true }',
    );
    expect(routeRegistry).toContain('{ element: <AppSettingsGeneral />, path: "general" }');
    expect(routeRegistry).toContain('{ element: <AppUsage />, path: "usage" }');
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/app-settings/general" replace />, path: "app" }',
    );
    expect(routeRegistry).not.toContain("OrganizationGeneralTab");
  });

  test("keeps Agent Cost run-purpose filters aligned with App Usage", () => {
    const agentCostTab = readSource("../src/routes/agent/components/cost-tab.tsx");

    expect(agentCostTab).toContain("RUN_PURPOSE_FILTERS.map");
    expect(agentCostTab).toContain("runPurposeToQuery(purpose)");
    expect(agentCostTab).not.toContain('label: "Preview"');
    expect(agentCostTab).not.toContain("preview run purposes");
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

  test("routes publish API token guidance to Access Tokens settings", () => {
    const apiAccessPanel = readSource("../src/routes/agent/lifecycle/api-access-panel.tsx");
    const distributionInfo = readSource("../src/routes/agent/lifecycle/distribution-info.ts");

    expect(distributionInfo).toContain(
      'const ACCESS_TOKEN_SETTINGS_PATH = "/settings/access-tokens";',
    );
    expect(apiAccessPanel).toContain('import { Link } from "react-router-dom";');
    expect(apiAccessPanel).toContain("<Link to={distribution.tokenSettingsPath}>");
    expect(apiAccessPanel).not.toContain("<a href={distribution.tokenSettingsPath}>");
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

  test("keeps account Settings in the account menu without adding a generic primary nav item", () => {
    const accountMenu = readSource("../src/app/account-menu.tsx");
    const primaryNav = readSource("../src/app/navigation.tsx");

    expect(accountMenu).toContain('to="/settings"');
    expect(accountMenu).not.toContain('to="/apps"');
    expect(primaryNav).toContain('label: "Settings"');
    expect(primaryNav).toContain('path: "/app-settings"');
  });
});
