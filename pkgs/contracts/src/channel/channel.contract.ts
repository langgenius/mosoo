import { PUBLIC_API_PREFIX, PUBLIC_API_VERSION } from "../http/public-api.contract.ts";
import type { ChannelBindingId } from "../id/id.contract";

export const AGENT_CHANNEL_BINDING_PROVIDERS = [
  "discord",
  "lark",
  "slack",
  "telegram",
  "wechat",
] as const;

export type AgentChannelBindingProvider = (typeof AGENT_CHANNEL_BINDING_PROVIDERS)[number];

export const AGENT_CHANNEL_WEBHOOK_PROVIDERS = [
  "discord",
  "lark",
  "slack",
  "telegram",
] as const satisfies readonly AgentChannelBindingProvider[];

export type AgentChannelWebhookProvider = (typeof AGENT_CHANNEL_WEBHOOK_PROVIDERS)[number];
export type BindingScopedAgentChannelWebhookProvider = Exclude<
  AgentChannelWebhookProvider,
  "slack"
>;

export const AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS = {
  discord: `/${PUBLIC_API_VERSION}/channels/discord/events/:bindingId`,
  lark: `/${PUBLIC_API_VERSION}/channels/lark/events/:bindingId`,
  slack: `/${PUBLIC_API_VERSION}/channels/slack/events`,
  telegram: `/${PUBLIC_API_VERSION}/channels/telegram/events/:bindingId`,
} as const satisfies Record<AgentChannelWebhookProvider, string>;

export type BuildAgentChannelWebhookPathInput =
  | { provider: "slack" }
  | { bindingId: ChannelBindingId; provider: BindingScopedAgentChannelWebhookProvider };

export function isAgentChannelWebhookProvider(
  provider: string,
): provider is AgentChannelWebhookProvider {
  return (AGENT_CHANNEL_WEBHOOK_PROVIDERS as readonly string[]).includes(provider);
}

export function buildAgentChannelWebhookPath(input: BuildAgentChannelWebhookPathInput): string {
  const pattern = AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS[input.provider];

  if (input.provider === "slack") {
    return `${PUBLIC_API_PREFIX}${pattern}`;
  }

  return `${PUBLIC_API_PREFIX}${pattern.replace(":bindingId", encodeURIComponent(input.bindingId))}`;
}

export function buildAgentChannelWebhookUrl(
  input: BuildAgentChannelWebhookPathInput & { origin: string },
): string {
  return `${input.origin.replace(/\/+$/u, "")}${buildAgentChannelWebhookPath(input)}`;
}
