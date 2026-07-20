import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { parseDiscordCredentials } from "../discord/discord-credentials";
import { DiscordWebApiClient } from "../discord/discord-web-api";
import { parseLarkCredentials } from "../lark/lark-credentials";
import { LarkWebApiClient } from "../lark/lark-web-api";
import { parseSlackCredentials } from "../slack/slack-credentials";
import { SlackWebApiClient } from "../slack/slack-web-api";
import { parseTelegramCredentials } from "../telegram/telegram-credentials";
import { TelegramWebApiClient } from "../telegram/telegram-web-api";
import { sendWeChatStoredContextReply } from "../wechat/wechat-reply.service";
import { buildChannelSessionLink } from "./channel-agent-reply";
import type { ChannelAgentReplyResult } from "./channel-agent-reply";
import type {
  ChannelFinalDeliveryPayload,
  DiscordFinalDeliveryPayload,
  LarkFinalDeliveryPayload,
  SlackFinalDeliveryPayload,
  TelegramFinalDeliveryPayload,
  WeChatFinalDeliveryPayload,
} from "./channel-final-delivery-message";
import type { AgentChannelBindingContext as ResolvedAgentChannelBindingContext } from "./channel-session.types";

type AgentChannelBindingContext = ResolvedAgentChannelBindingContext | null;

function truncateReplyText(input: { maxLength: number; text: string }): string {
  if (input.text.length <= input.maxLength) {
    return input.text;
  }

  return `${input.text.slice(0, input.maxLength - 70)}\n\n[mosoo reply truncated. Open the session for the full output.]`;
}

function buildAgentReplyText(input: {
  maxLength: number | null;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
  sessionLabel: string;
}): string {
  const text = input.result.text;
  const replyText =
    text && input.maxLength
      ? truncateReplyText({ maxLength: input.maxLength, text })
      : (text ?? null);

  switch (input.result.status) {
    case "completed": {
      return replyText
        ? `${input.sessionLabel}\n\n${replyText}`
        : `${input.sessionLabel}\n\nAgent completed. Open mosoo for the full output.`;
    }
    case "failed": {
      return `${input.sessionLabel}\n\nAgent run failed: ${replyText ?? "Open mosoo for details."}`;
    }
    case "timeout": {
      return replyText
        ? [
            input.sessionLabel,
            "",
            replyText,
            "",
            "Agent is still running. Open mosoo for the latest output.",
          ].join("\n")
        : `${input.sessionLabel}\n\nAgent is still running. Open mosoo for the latest output.`;
    }
    default: {
      throw new Error("Unsupported channel final delivery result status.");
    }
  }
}

async function sendDiscordFinalReply(input: {
  binding: AgentChannelBindingContext;
  payload: DiscordFinalDeliveryPayload;
  providerRequestTimeoutMs: number;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
}): Promise<void> {
  const binding = input.binding;

  if (!binding) {
    throw new Error("Discord final delivery binding is missing.");
  }

  const credentials = parseDiscordCredentials(binding.credentialsJson);
  const discord = new DiscordWebApiClient(credentials.botToken, {
    timeoutMs: input.providerRequestTimeoutMs,
  });

  await discord.editMessage({
    channelId: input.payload.workingMessage.channelId,
    messageId: input.payload.workingMessage.messageId,
    text: buildAgentReplyText({
      maxLength: 1900,
      result: input.result,
      sessionId: input.sessionId,
      sessionLabel: `mosoo session ${input.sessionId}`,
    }),
  });
}

async function sendSlackFinalReply(input: {
  binding: AgentChannelBindingContext;
  payload: SlackFinalDeliveryPayload;
  providerRequestTimeoutMs: number;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
  sessionLinkBaseUrl: string | null;
}): Promise<void> {
  const binding = input.binding;

  if (!binding) {
    throw new Error("Slack final delivery binding is missing.");
  }

  const credentials = parseSlackCredentials(binding.credentialsJson);
  const slack = new SlackWebApiClient(credentials.botToken, {
    timeoutMs: input.providerRequestTimeoutMs,
  });
  const sessionLink = buildChannelSessionLink({
    agentId: binding.agentId,
    sessionId: input.sessionId,
    sessionLinkBaseUrl: input.sessionLinkBaseUrl,
  });
  const text = buildAgentReplyText({
    maxLength: 3500,
    result: input.result,
    sessionId: input.sessionId,
    sessionLabel: `mosoo session <${sessionLink}|${input.sessionId}>`,
  });

  if (input.payload.workingMessage) {
    await slack.updateMessage({
      channelId: input.payload.workingMessage.channelId,
      text,
      ts: input.payload.workingMessage.ts,
    });
    return;
  }

  await slack.postChatMessage({
    channelId: input.payload.channelId,
    text,
    threadTs: input.payload.threadTs,
  });
}

async function sendLarkFinalReply(input: {
  binding: AgentChannelBindingContext;
  payload: LarkFinalDeliveryPayload;
  providerRequestTimeoutMs: number;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
}): Promise<void> {
  const binding = input.binding;

  if (!binding) {
    throw new Error("Lark final delivery binding is missing.");
  }

  const credentials = parseLarkCredentials(binding.credentialsJson);
  const lark = new LarkWebApiClient({
    ...credentials,
    timeoutMs: input.providerRequestTimeoutMs,
  });
  const tenantAccessToken = await lark.getTenantAccessToken();

  await lark.replyMessage({
    messageId: input.payload.messageId,
    tenantAccessToken,
    text: buildAgentReplyText({
      maxLength: null,
      result: input.result,
      sessionId: input.sessionId,
      sessionLabel: `mosoo session ${input.sessionId}`,
    }),
  });
}

async function sendTelegramFinalReply(input: {
  binding: AgentChannelBindingContext;
  payload: TelegramFinalDeliveryPayload;
  providerRequestTimeoutMs: number;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
}): Promise<void> {
  const binding = input.binding;

  if (!binding) {
    throw new Error("Telegram final delivery binding is missing.");
  }

  const credentials = parseTelegramCredentials(binding.credentialsJson);
  const telegram = new TelegramWebApiClient(credentials.botToken, {
    timeoutMs: input.providerRequestTimeoutMs,
  });

  await telegram.sendMessage({
    chatId: input.payload.chatId,
    messageThreadId: input.payload.messageThreadId,
    text: buildAgentReplyText({
      maxLength: 3900,
      result: input.result,
      sessionId: input.sessionId,
      sessionLabel: `mosoo session ${input.sessionId}`,
    }),
  });
}

async function sendWeChatFinalReply(input: {
  binding: AgentChannelBindingContext;
  bindings: ApiBindings;
  payload: WeChatFinalDeliveryPayload;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
}): Promise<void> {
  const binding = input.binding;

  if (!binding) {
    throw new Error("WeChat final delivery binding is missing.");
  }

  await sendWeChatStoredContextReply(input.bindings, {
    accountId: binding.bindingId,
    peerId: input.payload.peerId,
    text: buildAgentReplyText({
      maxLength: 3000,
      result: input.result,
      sessionId: input.sessionId,
      sessionLabel: `mosoo session ${input.sessionId}`,
    }),
  });
}

export async function sendProviderFinalReply(input: {
  binding: AgentChannelBindingContext;
  bindings: ApiBindings;
  payload: ChannelFinalDeliveryPayload;
  providerRequestTimeoutMs: number;
  result: ChannelAgentReplyResult;
  sessionId: SessionId;
  sessionLinkBaseUrl: string | null;
}): Promise<void> {
  switch (input.payload.provider) {
    case "discord": {
      await sendDiscordFinalReply({
        binding: input.binding,
        payload: input.payload,
        providerRequestTimeoutMs: input.providerRequestTimeoutMs,
        result: input.result,
        sessionId: input.sessionId,
      });
      return;
    }
    case "lark": {
      await sendLarkFinalReply({
        binding: input.binding,
        payload: input.payload,
        providerRequestTimeoutMs: input.providerRequestTimeoutMs,
        result: input.result,
        sessionId: input.sessionId,
      });
      return;
    }
    case "slack": {
      await sendSlackFinalReply({
        binding: input.binding,
        payload: input.payload,
        providerRequestTimeoutMs: input.providerRequestTimeoutMs,
        result: input.result,
        sessionId: input.sessionId,
        sessionLinkBaseUrl: input.sessionLinkBaseUrl,
      });
      return;
    }
    case "telegram": {
      await sendTelegramFinalReply({
        binding: input.binding,
        payload: input.payload,
        providerRequestTimeoutMs: input.providerRequestTimeoutMs,
        result: input.result,
        sessionId: input.sessionId,
      });
      return;
    }
    case "wechat": {
      await sendWeChatFinalReply({
        binding: input.binding,
        bindings: input.bindings,
        payload: input.payload,
        result: input.result,
        sessionId: input.sessionId,
      });
      return;
    }
    default: {
      throw new Error("Unsupported channel final delivery provider.");
    }
  }
}
