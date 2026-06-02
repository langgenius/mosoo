import { describe, expect, test } from "bun:test";

import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import { parse } from "yaml";

import { buildSlackManifest } from "../src/routes/agent/components/settings-dialog-slack-manifest";

describe("Slack channel setup", () => {
  test("includes the PRD-required Slack scopes and events in manifest YAML", () => {
    const manifest = buildSlackManifest("Launch Agent");
    const parsed = parse(manifest);

    expect(parsed.display_information.name).toBe("Launch Agent");
    expect(parsed.settings.event_subscriptions.request_url).toBe(
      buildAgentChannelWebhookUrl({
        origin: "https://mosoo.ai",
        provider: "slack",
      }),
    );
    expect(parsed.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining([
        "app_mentions:read",
        "channels:history",
        "chat:write",
        "files:read",
        "groups:history",
        "im:history",
        "im:read",
        "im:write",
        "users:read",
      ]),
    );
    expect(parsed.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining(["app_mention", "message.channels", "message.im"]),
    );
  });

  test("keeps agent names as YAML scalar data", () => {
    const agentName = "Growth: Q1\nsettings:\n  socket_mode_enabled: true";
    const manifest = buildSlackManifest(agentName);
    const parsed = parse(manifest);

    expect(parsed.display_information.name).toBe(agentName);
    expect(parsed.settings.socket_mode_enabled).toBe(false);
  });
});
