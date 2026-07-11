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
    // The header/body composition lives in the VibeSurface rendered by "/".
    const surfaceSource = readSource("../src/routes/app-overview/vibe/vibe-surface.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");
    const appIdBadgeSource = readSource("../src/shared/ui/app-id-badge.tsx");
    const runtimeIconSource = readSource("../src/shared/ui/brand-icons/runtime-icon-data.ts");

    expect(routeSource).toContain("AppOverviewInstallGuide");
    expect(surfaceSource).toContain("AppIdBadge");
    expect(installSource).toContain("Build agent app with");
    expect(installSource).toContain("coding");
    expect(installSource).toContain("text-[rgb(111_211_4)]");
    expect(installSource).toContain("bg-[rgb(111_211_4)]");
    expect(installSource).toContain("hover:bg-[rgb(111_211_4)]");
    expect(installSource).toContain("curl -fsSL https://install.mosoo.ai/install.sh | bash");
    expect(installSource).toContain("Installs Mosoo CLI");
    expect(installSource).toContain("Installs the @mosoo skill");
    expect(installSource).toContain("Signs in to cloud and runs doctor");
    expect(installSource).toContain("try.mosoo.ai");
    expect(installSource).toContain("@mosoo skill");
    expect(installSource).toContain('"Copy"');
    expect(installSource).toContain("Create API token");
    expect(installSource).toContain("/settings/access-tokens");
    expect(installSource).toContain("CODING_AGENT_HARNESSES");
    expect(installSource).toContain("Supported coding agent harnesses");
    expect(installSource).toContain("Codex");
    expect(installSource).toContain("Claude Code");
    expect(installSource).toContain("OpenCode");
    expect(installSource).toContain("Cursor");
    expect(installSource).toContain("Cline");
    expect(runtimeIconSource).toContain("codex-color.svg");
    expect(runtimeIconSource).toContain("claudecode-color.svg");
    expect(runtimeIconSource).toContain("opencode.svg");
    expect(runtimeIconSource).toContain("cursor.svg");
    expect(runtimeIconSource).toContain("cline.svg");
    expect(installSource).not.toContain("Codex skill");
    expect(installSource).not.toContain("or updates");
    expect(installSource).not.toContain("Start building");
    expect(installSource).not.toContain("Build your App agent");
    expect(installSource).not.toContain("App agent");
    expect(installSource).not.toContain("refreshes");
    expect(installSource).not.toContain("Copy command");
    expect(appIdBadgeSource).toContain("Copy app ID");
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
  });

  test("keeps the install guide responsive and accessible", () => {
    const surfaceSource = readSource("../src/routes/app-overview/vibe/vibe-surface.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");

    expect(surfaceSource).toContain("max-w-4xl");
    expect(surfaceSource).toContain("sm:flex-row");
    expect(installSource).toContain("max-w-3xl");
    expect(installSource).toContain("sm:flex-row");
    expect(installSource).toContain("text-sm leading-6");
    expect(installSource).toContain("sm:text-base");
    expect(installSource).not.toContain("text-xs font-medium sm:grid-cols-3");
    expect(installSource).not.toContain("aria-expanded");
    expect(installSource).not.toContain("aria-controls");
    expect(installSource).not.toContain("Codex, Cursor, Cline");
    expect(installSource).not.toContain("whitespace-pre-wrap");
    expect(installSource).not.toContain("—");
    expect(installSource).not.toContain(" · ");
  });

  test("keeps the App console root free of Chinese copy", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");

    const cjk = /[一-鿿]/u;
    expect(cjk.test(routeSource)).toBe(false);
    expect(cjk.test(installSource)).toBe(false);
  });
});
