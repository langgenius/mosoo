import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import type { ChannelBindingId } from "@mosoo/id";

import type { DiscordGatewayDispatchEnvelope } from "./discord-events";
import { createDiscordRelaySignature } from "./discord-signing";

export interface DiscordGatewayRelayRequest {
  body: string;
  headers: Record<string, string>;
  url: string;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
}

export function buildDiscordGatewayRelayBody(input: {
  envelope: DiscordGatewayDispatchEnvelope;
  relayChannelType: number;
}): string {
  assertSafeInteger(input.relayChannelType, "Discord relay channel type");

  return JSON.stringify({
    d: {
      author: {
        bot: input.envelope.message.author.bot,
        id: input.envelope.message.author.id,
        username: input.envelope.message.author.username,
      },
      channel_id: input.envelope.message.channelId,
      content: input.envelope.message.content,
      guild_id: input.envelope.message.guildId,
      id: input.envelope.message.id,
      relay_channel_type: input.relayChannelType,
    },
    op: 0,
    s: input.envelope.sequence,
    t: "MESSAGE_CREATE",
  });
}

export async function createDiscordGatewayRelayRequest(input: {
  apiBaseUrl: string;
  bindingId: ChannelBindingId;
  envelope: DiscordGatewayDispatchEnvelope;
  nowSeconds: number;
  relayChannelType: number;
  relaySecret: string;
}): Promise<DiscordGatewayRelayRequest> {
  assertSafeInteger(input.nowSeconds, "Discord relay timestamp");

  const body = buildDiscordGatewayRelayBody({
    envelope: input.envelope,
    relayChannelType: input.relayChannelType,
  });
  const timestamp = String(input.nowSeconds);

  return {
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-mosoo-discord-relay-signature": await createDiscordRelaySignature({
        body,
        relaySecret: input.relaySecret,
        timestamp,
      }),
      "x-mosoo-discord-relay-timestamp": timestamp,
    },
    url: buildAgentChannelWebhookUrl({
      bindingId: input.bindingId,
      origin: input.apiBaseUrl,
      provider: "discord",
    }),
  };
}
