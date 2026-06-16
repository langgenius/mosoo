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

  test("hands the App to a coding agent with one CLI command on the console root", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");

    expect(routeSource).toContain("AppOverviewInstallGuide");
    expect(installSource).toContain("Hand Mosoo to your agent");
    expect(installSource).toContain("npx mosoo login");
    expect(installSource).toContain("@mosoo skill");
    expect(installSource).toContain("Codex");
    // The CLI token is minted on demand and only copied — never rendered.
    expect(installSource).toContain("createPersonalAccessToken");
    expect(installSource).toContain("MASKED_TOKEN");

    expect(installSource).not.toContain("Organization");
    expect(installSource).not.toContain("Members");
    expect(installSource).not.toContain("Invite");
  });

  test("keeps the App console root free of Chinese copy", () => {
    const routeSource = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const installSource = readSource("../src/routes/app-overview/app-overview-install.tsx");

    const cjk = /[一-鿿]/u;
    expect(cjk.test(routeSource)).toBe(false);
    expect(cjk.test(installSource)).toBe(false);
  });
});
