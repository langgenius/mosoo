import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";

import { resolveChannelWebhookOrigin } from "./channel-webhook-origin";

export const SLACK_APP_LEVEL_TOKEN_LABEL = "App-Level Token (optional)";
export const SLACK_THREAD_REPLY_MENTION_LABEL = "Require mentions in thread replies";
export const SLACK_MANIFEST_HELP_URL =
  "https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests";

function getRequestUrl(): string {
  return buildAgentChannelWebhookUrl({ origin: resolveChannelWebhookOrigin(), provider: "slack" });
}

function toYamlQuotedScalar(value: string): string {
  return JSON.stringify(value);
}

export function buildSlackManifest(agentName: string): string {
  return [
    "display_information:",
    `  name: ${toYamlQuotedScalar(agentName)}`,
    "features:",
    "  bot_user:",
    "    display_name: mosoobot",
    "    always_online: true",
    "oauth_config:",
    "  scopes:",
    "    bot:",
    "      - app_mentions:read",
    "      - channels:history",
    "      - chat:write",
    "      - files:read",
    "      - groups:history",
    "      - im:history",
    "      - im:read",
    "      - im:write",
    "      - users:read",
    "settings:",
    "  event_subscriptions:",
    `    request_url: ${getRequestUrl()}`,
    "    bot_events:",
    "      - app_mention",
    "      - message.channels",
    "      - message.im",
    "  org_deploy_enabled: false",
    "  socket_mode_enabled: false",
    "  token_rotation_enabled: false",
  ].join("\n");
}
