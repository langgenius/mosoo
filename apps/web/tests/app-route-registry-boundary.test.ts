import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("App route registry boundary", () => {
  test("uses App Overview as the protected console root", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).toContain("AppOverviewPage");
    expect(source).toContain('path: "/"');
    expect(source).toContain("protectedRoute(<AppOverview />)");
    expect(source).not.toContain('protectedRoute(<Navigate to="/agent" replace />), path: "/"');
  });

  test("does not keep public Members or invite/join aliases", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).not.toContain('path: "/members"');
    expect(source).not.toContain('path: "members"');
    expect(source).not.toContain('path: "/join/:organizationId"');
  });

  test("drops the standalone Channels route and per-agent channel setup routes", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).not.toContain("ChannelsPage");
    expect(source).not.toContain('path: "/channels"');
    expect(source).not.toContain("protectedRoute(<Channels />)");
    expect(source).not.toContain('path: "/agent/:agentId/channels"');
    expect(source).not.toContain('path: "/agent/:agentId/channels/new"');
    expect(source).not.toContain("slack-channel-setup");
  });

  test("does not expose the old Organization Provider demo route", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).not.toContain("ProviderDemo");
    expect(source).not.toContain("provider-demo.route");
    expect(source).not.toContain('path: "/demo/provider"');
    expect(source).not.toContain('path: "system-agent"');
  });
});
