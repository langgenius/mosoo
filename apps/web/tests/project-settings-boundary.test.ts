import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Project settings boundary", () => {
  test("does not expose Organization-owned settings as Project console settings", () => {
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

    expect(settingsNav).toContain('labelKey: "settings.profile"');
    expect(settingsNav).toContain('labelKey: "settings.accessTokens"');
    expect(settingsNav).not.toContain('label: "Project usage"');
    expect(settingsNav).not.toContain('label: "Project"');
    expect(settingsNav).not.toContain('path: "/settings/usage"');
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/project-settings/usage" replace />, path: "usage" }',
    );
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/project-settings/usage" replace />, path: "cost" }',
    );
    expect(routeRegistry).not.toContain("<SettingsUsage />");
  });

  test("keeps Project settings in the Project sidebar as Settings", () => {
    const settingsNav = readSource("../src/routes/settings/settings-nav.tsx");
    const projectSettingsNav = readSource(
      "../src/routes/project-settings/project-settings-nav.tsx",
    );
    const routeRegistry = readSource("../src/app/route-registry.tsx");
    const primaryNav = readSource("../src/app/navigation.tsx");

    expect(settingsNav).toContain('labelKey: "settings.account"');
    expect(settingsNav).not.toContain('label: "General"');
    expect(settingsNav).not.toContain('path: "/settings/project"');
    expect(primaryNav).toContain('t("nav.settings")');
    expect(primaryNav).not.toContain('label: "Project usage"');
    expect(primaryNav).toContain('path: "/project-settings"');
    expect(projectSettingsNav).toContain('labelKey: "settings.general"');
    expect(projectSettingsNav).toContain('labelKey: "projectSettings.usage"');
    expect(projectSettingsNav).toContain('path: "/project-settings/general"');
    expect(projectSettingsNav).toContain('path: "/project-settings/usage"');
    expect(routeRegistry).toContain(
      'async () => import("../routes/project-settings/project-settings.route")',
    );
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/project-settings/general" replace />, index: true }',
    );
    expect(routeRegistry).toContain('{ element: <ProjectSettingsGeneral />, path: "general" }');
    expect(routeRegistry).toContain('{ element: <ProjectUsage />, path: "usage" }');
    expect(routeRegistry).toContain(
      '{ element: <Navigate to="/project-settings/general" replace />, path: "project" }',
    );
    expect(routeRegistry).not.toContain("OrganizationGeneralTab");
  });

  test("keeps Agent Cost run-purpose filters aligned with Project Usage", () => {
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

    expect(accessTokens).toContain('t("settings.createTokenDescription")');
    expect(accessTokens).toContain('t("agent.apiReference")');
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
    expect(accountMenu).not.toContain('to="/projects"');
    expect(primaryNav).toContain('t("nav.settings")');
    expect(primaryNav).toContain('path: "/project-settings"');
  });
});
