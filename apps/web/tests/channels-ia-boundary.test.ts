import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Channels IA boundary", () => {
  test("makes Channels an App entry that selects an App-local Agent", () => {
    const source = readSource("../src/routes/channels/channels.route.tsx");

    expect(source).toContain("useAppSession");
    expect(source).toContain("useVisibleAgentsQuery(activeAppId)");
    expect(source).toContain("ChannelsConfigDialog");
    expect(source).toContain("App Channels");
    expect(source).toContain("App-local Agent");
    expect(source).toContain("Configure channels");
    expect(source).toContain('to="/agent?create=1"');
    expect(source).not.toContain("Organization");
    expect(source).not.toContain("Members");
    expect(source).not.toContain("Admin");
  });

  test("keeps setup execution on Agent channel bindings with explicit App proof", () => {
    const dialogSource = readSource("../src/routes/agent/components/channels-config-dialog.tsx");
    const fieldSource = readSource("../src/routes/agent/components/channels-field.tsx");
    const settingsSource = readSource(
      "../src/routes/agent/components/settings-dialog-channels-view.tsx",
    );

    expect(dialogSource).toContain("useAgentChannelBindingsQuery(agent.appId, agent.id)");
    expect(dialogSource).toContain("appId: toAppId(agent.appId)");
    expect(dialogSource).toContain('agent.role === "owner"');
    expect(dialogSource).not.toContain('agent.role === "admin"');
    expect(fieldSource).toContain("useAgentChannelBindingsQuery(agent.appId, agent.id)");
    expect(fieldSource).toContain('agent.role === "owner"');
    expect(fieldSource).not.toContain('agent.role === "admin"');
    expect(settingsSource).toContain("Only the Agent owner in this App can connect channels.");
    expect(settingsSource).not.toContain("Owners and Admins");
  });
});
