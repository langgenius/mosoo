import type { AgentChannelBindingProvider } from "@mosoo/db";

import type { SlackMessageReference } from "../slack/slack-web-api";
import type {
  ChannelFinalDeliveryPayload,
  DiscordFinalDeliveryPayload,
} from "./channel-final-delivery-message";

export class ChannelFinalDeliveryPayloadError extends Error {
  override name = "ChannelFinalDeliveryPayloadError";
}

function payloadError(message: string): ChannelFinalDeliveryPayloadError {
  return new ChannelFinalDeliveryPayloadError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }

  throw payloadError(`Channel final delivery payload ${field} is required.`);
}

function readNullableNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];

  if (candidate === null || candidate === undefined) {
    return null;
  }

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  throw payloadError(`Channel final delivery payload ${field} must be a number or null.`);
}

function parseSlackWorkingMessage(value: unknown): SlackMessageReference | null {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw payloadError("Slack final delivery working message must be an object or null.");
  }

  return {
    channelId: readString(value, "channelId"),
    ts: readString(value, "ts"),
  };
}

function parseDiscordWorkingMessage(value: unknown): DiscordFinalDeliveryPayload["workingMessage"] {
  if (!isRecord(value)) {
    throw payloadError("Discord final delivery working message must be an object.");
  }

  return {
    channelId: readString(value, "channelId"),
    messageId: readString(value, "messageId"),
  };
}

export function parseChannelFinalDeliveryPayload(
  provider: AgentChannelBindingProvider,
  value: unknown,
): ChannelFinalDeliveryPayload {
  if (!isRecord(value) || value["provider"] !== provider) {
    throw payloadError("Channel final delivery payload provider does not match the job.");
  }

  switch (provider) {
    case "discord": {
      return {
        channelId: readString(value, "channelId"),
        provider,
        workingMessage: parseDiscordWorkingMessage(value["workingMessage"]),
      };
    }
    case "lark": {
      return {
        messageId: readString(value, "messageId"),
        provider,
      };
    }
    case "slack": {
      return {
        channelId: readString(value, "channelId"),
        provider,
        threadTs: readString(value, "threadTs"),
        workingMessage: parseSlackWorkingMessage(value["workingMessage"]),
      };
    }
    case "telegram": {
      return {
        chatId: readString(value, "chatId"),
        messageThreadId: readNullableNumber(value, "messageThreadId"),
        provider,
      };
    }
    case "wechat": {
      return {
        peerId: readString(value, "peerId"),
        provider,
      };
    }
    default: {
      throw payloadError("Unsupported channel final delivery provider.");
    }
  }
}

export function parseChannelFinalDeliveryPayloadJson(
  provider: AgentChannelBindingProvider,
  payloadJson: string,
): ChannelFinalDeliveryPayload {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return parseChannelFinalDeliveryPayload(provider, parsed);
  } catch (error) {
    if (error instanceof ChannelFinalDeliveryPayloadError) {
      throw error;
    }

    throw payloadError("Channel final delivery payload JSON is invalid.");
  }
}
