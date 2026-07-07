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
    const surfaceSource = readSource("../src/routes/app-overview/deploy/deploy-surface.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");

    expect(surfaceSource).toContain("max-w-4xl");
    expect(surfaceSource).toContain("lg:flex-row");
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

describe("Deploy console native boundary", () => {
  test("names what detection found instead of a detecting placeholder", () => {
    const historySource = readSource(
      "../src/routes/app-overview/deploy/components/deployments-history.tsx",
    );
    const dataSource = readSource("../src/routes/app-overview/deploy/deploy-console-data.ts");

    expect(historySource).not.toContain("detecting target");
    expect(historySource).toContain("deployTargetLine");
    expect(historySource).toContain('data-testid="deploy-run-row"');
    expect(historySource).toContain('data-testid="deploy-run-detection"');
    expect(historySource).toContain('data-testid="deploy-run-details"');
    expect(historySource).toContain('data-testid="deploy-failure-row"');
    expect(historySource).toContain('data-testid="deploy-provision-row"');

    expect(dataSource).toContain("mosoo-native");
    expect(dataSource).toContain('agent_only: "agent api"');
    expect(dataSource).toContain('"agent-only" | "native-red" | "web" | "web-and-agents"');
    expect(dataSource).toContain("native_validation_failed");
    expect(dataSource).toContain("native.setup.environment_secret");
  });

  test("gives agent-only deploys an agents hero and hides the web production rows", () => {
    const overviewSource = readSource(
      "../src/routes/app-overview/deploy/components/deploy-overview.tsx",
    );
    const urlCardSource = readSource(
      "../src/routes/app-overview/deploy/components/deploy-url-card.tsx",
    );
    const repoCardSource = readSource(
      "../src/routes/app-overview/deploy/components/deploy-repo-card.tsx",
    );

    expect(overviewSource).toContain('data-testid="deploy-agents-card"');
    expect(overviewSource).toContain("Deployed agents");
    expect(urlCardSource).toContain("Agent API only · no production web URL");
    expect(repoCardSource).toContain(
      "Auto-detects static, worker or agent-only · .mosoo.toml optional override",
    );
    expect(repoCardSource).not.toContain("Auto-detects static or worker");
  });

  test("keeps the acceptance route covering every exposure scenario plus the agent instance", () => {
    const previewSource = readSource(
      "../src/routes/app-overview/deploy/v0-deploy-preview.route.tsx",
    );

    for (const scenario of [
      '"web"',
      '"agent-only"',
      '"web-and-agents"',
      '"native-red"',
      '"instance"',
    ]) {
      expect(previewSource).toContain(scenario);
    }
    expect(previewSource).toContain("Fixture scenario");
    expect(previewSource).toContain("Simulate failed deploy");
    // The "instance" scenario swaps in the agent-list prototype and its
    // repo-level activity feed.
    expect(previewSource).toContain("AgentDashboard");
    expect(previewSource).toContain("INSTANCE_RUNS");
  });
});
