import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App overview boundary", () => {
  test("keeps the console root as the App install page without dashboard fetches", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");

    expect(routeSource).toContain("AppOverviewInstallGuide");
    expect(routeSource).toContain("Provider keys");
    expect(routeSource).toContain("New agent");

    // The overview dashboard and its per-resource queries were removed; the root
    // no longer aggregates loads (which surfaced "data failed to load").
    expect(routeSource).not.toContain("Quickstart");
    expect(routeSource).not.toContain("App overview data failed to load");
    expect(routeSource).not.toContain("useVisibleAgentsQuery");
    expect(routeSource).not.toContain("fetchAppCost");
    expect(routeSource).not.toContain("listVendorCredentials");
    expect(routeSource).not.toContain('to="/channels"');

    expect(routeSource).not.toContain("Organization");
    expect(routeSource).not.toContain("Members");
    expect(routeSource).not.toContain("Invite");
    expect(routeSource).not.toContain('to="/members"');
    expect(routeSource).not.toContain('to="/join');
  });

  test("hands the App to a coding agent with the installer command on the console root", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    // The header/body composition lives in the shared DeploySurface, rendered
    // verbatim by both "/" and the /v0-deploy-preview acceptance route.
    const surfaceSource = readSource("../src/routes/app-overview/deploy/deploy-surface.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const promptSource = readSource("../src/routes/app-overview/onboarding-setup-prompt.ts");
    const appIdBadgeSource = readSource("../src/shared/ui/app-id-badge.tsx");
    const runtimeIconSource = readSource("../src/shared/ui/brand-icons/runtime-icon-data.ts");

    expect(routeSource).toContain("AppOverviewInstallGuide");
    expect(surfaceSource).toContain("AppIdBadge");
    expect(installSource).toContain('t("onboarding.title")');
    expect(installSource).toContain("coding");
    expect(installSource).toContain("bg-[rgb(111_211_4)]");
    expect(installSource).toContain("hover:bg-[rgb(111_211_4)]");
    expect(promptSource).toContain("curl -fsSL https://install.mosoo.ai/install.sh | bash");
    expect(installSource).toContain('t("onboarding.setupDescription")');
    expect(installSource).toContain('t("common.copy")');
    expect(appIdBadgeSource).toContain("Copy app ID");

    expect(installSource).not.toContain("Codex skill");
    expect(installSource).not.toContain("or updates");
    expect(installSource).not.toContain("Start building");
    expect(installSource).not.toContain("Build your App agent");
    expect(installSource).not.toContain("App agent");
    expect(installSource).not.toContain("refreshes");
    expect(installSource).not.toContain("Copy command");
    expect(installSource).not.toContain("createPersonalAccessToken");
    expect(installSource).not.toContain("MASKED_TOKEN");
    expect(installSource).not.toContain("Signs the CLI in");
    expect(installSource).not.toContain("Ready to deploy");
    expect(installSource).not.toContain("No global config");
    expect(installSource).not.toContain("Using another agent");
    expect(installSource).not.toContain("Copy or download");
    expect(installSource).not.toContain("Copy skill");
    expect(installSource).not.toContain("Download SKILL.md");

    expect(installSource).not.toContain("Organization");
    expect(installSource).not.toContain("Members");
    expect(installSource).not.toContain("Invite");

    expect(runtimeIconSource).toContain("codex-color.svg");
    expect(runtimeIconSource).toContain("claudecode-color.svg");
    expect(runtimeIconSource).toContain("opencode.svg");
    expect(runtimeIconSource).toContain("cursor.svg");
    expect(runtimeIconSource).toContain("cline.svg");
  });

  test("walks onboarding as three clickable steps with two follow-up actions", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const stepsSource = readSource("../src/routes/app-overview/onboarding-steps.tsx");
    const promptSource = readSource("../src/routes/app-overview/onboarding-setup-prompt.ts");

    // The hero splits into two explicit setup lanes: the coding-agent lane
    // (install command plus follow-up actions) and the console lane (the
    // checklist). The last chosen lane is remembered locally.
    expect(installSource).toContain('label={t("onboarding.inCodingAgent")}');
    expect(installSource).toContain('label={t("onboarding.inConsole")}');
    expect(installSource).toContain("aria-pressed");
    expect(installSource).toContain('t("onboarding.subtitle")');
    expect(installSource).toContain("mosoo_overview_setup_lane");
    expect(installSource).toContain("OnboardingSteps");
    expect(installSource).toContain("OnboardingActions");
    expect(installSource).toContain("DocsAction");

    // Three steps, each a link into the matching console surface. Provider
    // credentials are required before a Run; API tokens are optional.
    expect(stepsSource).toContain('t("onboarding.addProviderKey")');
    expect(stepsSource).toContain('to: "/providers"');
    expect(stepsSource).toContain('t("onboarding.optional")');
    expect(stepsSource).toContain('t("onboarding.createApiToken")');
    expect(stepsSource).toContain('to: "/settings/access-tokens"');
    expect(stepsSource).toContain('t("onboarding.createAgent")');
    expect(stepsSource).toContain("/agent?create=1");
    expect(stepsSource).toContain("/threads?compose=1");

    // Progress reads stay below the route so failures degrade inside the
    // checklist instead of becoming an Overview error banner.
    expect(routeSource).not.toContain("useOnboardingProgress");

    // Follow-up actions: copy a setup prompt for any coding agent, or read
    // the docs.
    expect(stepsSource).toContain('t("onboarding.setupWithAgent")');
    expect(stepsSource).toContain("buildOnboardingSetupPrompt");
    expect(stepsSource).toContain("DocsAction");
    expect(stepsSource).toContain('t("onboarding.readDocs")');
    expect(stepsSource).toContain("HELP_DOCS_HOME_URL");
    expect(stepsSource).toContain("CODING_AGENT_HARNESSES");
    expect(stepsSource).toContain('t("onboarding.harnesses")');
    expect(stepsSource).toContain("Codex");
    expect(stepsSource).toContain("Claude Code");
    expect(stepsSource).toContain("OpenCode");
    expect(stepsSource).toContain("Cursor");
    expect(stepsSource).toContain("Cline");

    // The setup prompt mirrors the checklist and keeps the human-owned
    // provider key as an ask, not something an agent invents.
    expect(promptSource).toContain("MOSOO_CONSOLE_URL");
    expect(promptSource).toContain("/providers");
    expect(promptSource).toContain("/settings/access-tokens");
    expect(promptSource).toContain("/agent?create=1");
    expect(promptSource).toContain("ask the user");
    expect(promptSource).toContain("Never print or commit secrets");
  });

  test("keeps the install guide responsive and accessible", () => {
    const surfaceSource = readSource("../src/routes/app-overview/deploy/deploy-surface.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const stepsSource = readSource("../src/routes/app-overview/onboarding-steps.tsx");

    expect(surfaceSource).toContain("max-w-4xl");
    expect(surfaceSource).toContain("lg:flex-row");
    expect(installSource).toContain("max-w-3xl");
    expect(installSource).toContain("sm:flex-row");
    expect(stepsSource).toContain("text-sm leading-6");
    expect(stepsSource).toContain("sm:text-base");
    expect(stepsSource).toContain('aria-label={t("onboarding.steps")}');
    expect(installSource).not.toContain("aria-expanded");
    expect(installSource).not.toContain("aria-controls");
    expect(installSource).not.toContain("Codex, Cursor, Cline");
    expect(installSource).not.toContain("whitespace-pre-wrap");
    expect(installSource).not.toContain("—");
    expect(installSource).not.toContain(" · ");
    expect(stepsSource).not.toContain("—");
    expect(stepsSource).not.toContain(" · ");
  });

  test("keeps the App console root free of hardcoded Chinese copy in source", () => {
    // Chinese text belongs in translation JSON files (src/shared/i18n/translations/),
    // not hardcoded in TSX source. The CJK boundary test now verifies that
    // source files use i18n keys instead of inline Chinese strings.
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const stepsSource = readSource("../src/routes/app-overview/onboarding-steps.tsx");
    const promptSource = readSource("../src/routes/app-overview/onboarding-setup-prompt.ts");

    const cjk = /[一-鿿]/u;
    expect(cjk.test(routeSource)).toBe(false);
    expect(cjk.test(installSource)).toBe(false);
    expect(cjk.test(stepsSource)).toBe(false);
    expect(cjk.test(promptSource)).toBe(false);
  });

  test("translation files contain Chinese for zh-CN locale", () => {
    const zhCN = readSource("../src/shared/i18n/translations/zh-CN.json");
    const cjk = /[一-鿿]/u;
    expect(cjk.test(zhCN)).toBe(true);
  });

  test("translation files contain no Chinese in en locale", () => {
    const en = readSource("../src/shared/i18n/translations/en.json");
    const cjk = /[一-鿿]/u;
    expect(cjk.test(en)).toBe(false);
  });
});
