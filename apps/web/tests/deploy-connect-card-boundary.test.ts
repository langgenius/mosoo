import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/**
 * Source-level pins for the Connect surface: the name-addressed API card and
 * agent surface table on the Deploy overview, the namespace rows on the URL
 * card, and the exposed-agent gate on the agent-detail API panel. These guard
 * the contract Phase 3 builds on (testids + name-addressed path shape) without
 * standing up the full render.
 */
describe("Deploy Connect card boundary", () => {
  test("Connect card and surface table are name-addressed off the App slug", () => {
    const source = readSource("../src/routes/app-overview/deploy/components/deploy-overview.tsx");

    // Phase 3 hooks onto these testids.
    expect(source).toContain('data-testid="deploy-connect-card"');
    expect(source).toContain('data-testid="deploy-agent-surface-table"');
    expect(source).toContain('data-testid="deploy-agent-surface-row"');

    // The exposed-agent roster is derived from the run's native facts.
    expect(source).toContain("filter((agent) => agent.exposed)");

    // Coordinates are built from the name-addressed helpers, never an agent ULID.
    expect(source).toContain("appNamespaceAgentPath");
    expect(source).toContain("appNamespaceAgentCurl");
    expect(source).toContain("appNamespaceBasePath");

    // The playground link is the console consume surface.
    expect(source).toContain("?tab=consume");

    // The surface table carries only the four columns it can fill; the deferred
    // usage aggregation contributes no empty stats column.
    expect(source).toContain(">Agent</th>");
    expect(source).toContain(">Endpoint</th>");
    expect(source).toContain(">Live version</th>");
    expect(source).toContain(">curl / Try</th>");
    expect(source).not.toContain(">Usage</th>");
    expect(source).not.toContain(">Requests</th>");
  });

  test("namespace URL builders address agents by App slug and name", () => {
    const source = readSource("../src/routes/app-overview/deploy/deploy-console-mapping.ts");

    expect(source).toContain("/apps/${slug}");
    expect(source).toContain("/agents/${agentName}/threads");
  });

  test("URL card surfaces the namespace base and a playground row", () => {
    const source = readSource("../src/routes/app-overview/deploy/components/deploy-url-card.tsx");

    expect(source).toContain("NamespaceRows");
    expect(source).toContain("Agent API");
    expect(source).toContain("Playground");
    // The namespace rows sit outside the run-status branches so every branch keeps them.
    expect(source).toContain("namespace === null ? null : <NamespaceRows");
  });

  test("agent API panel goes name-addressed only for exposed agents on a slugged App", () => {
    const panelSource = readSource("../src/routes/agent/lifecycle/api-access-panel.tsx");
    const distributionSource = readSource("../src/routes/agent/lifecycle/distribution-info.ts");

    // The gate: App slug present AND the agent is exposed via the API namespace.
    expect(panelSource).toContain("agent.appSlug");
    expect(panelSource).toContain("agent.exposedViaApi === true");
    expect(panelSource).toContain("buildAgentNamespacePath");
    expect(panelSource).toContain("buildAgentNamespaceCurl");
    expect(panelSource).toContain('label="Endpoint"');
    // Console agents keep the ULID entry point.
    expect(panelSource).toContain('label="Agent ID"');

    // The name-addressed path is App-slug + agent-name, never the agent ULID.
    expect(distributionSource).toContain("/apps/${appSlug}/agents/${agentName}/threads");
  });
});
