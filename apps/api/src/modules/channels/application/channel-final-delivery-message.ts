import type { ChannelFinalDeliveryJobId } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";

import type { SlackMessageReference } from "../slack/slack-web-api";

export interface SlackFinalDeliveryPayload {
  channelId: string;
  provider: "slack";
  threadTs: string;
  workingMessage: SlackMessageReference | null;
}

export interface LarkFinalDeliveryPayload {
  messageId: string;
  provider: "lark";
}

export interface TelegramFinalDeliveryPayload {
  chatId: string;
  messageThreadId: number | null;
  provider: "telegram";
}

export interface DiscordFinalDeliveryPayload {
  channelId: string;
  provider: "discord";
  workingMessage: {
    channelId: string;
    messageId: string;
  };
}

export interface WeChatFinalDeliveryPayload {
  peerId: string;
  provider: "wechat";
}

export type ChannelFinalDeliveryPayload =
  | DiscordFinalDeliveryPayload
  | LarkFinalDeliveryPayload
  | SlackFinalDeliveryPayload
  | TelegramFinalDeliveryPayload
  | WeChatFinalDeliveryPayload;

export interface ChannelFinalDeliveryMessage {
  jobId: ChannelFinalDeliveryJobId;
}

export function parseChannelFinalDeliveryMessage(value: unknown): ChannelFinalDeliveryMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Channel final delivery queue message must be an object.");
  }

  const jobId = (value as Record<string, unknown>)["jobId"];

  return {
    jobId: parsePlatformId<ChannelFinalDeliveryJobId>(
      jobId,
      "Channel final delivery queue message jobId",
    ),
  };
}
