import type { AgentId, ChannelBindingId } from "@mosoo/id";

import { logChannelAdapterError } from "../application/channel-adapter-logger";
import {
  CHANNEL_AGENT_FAILURE_TEXT,
  buildChannelSessionLink,
  buildChannelWorkingText,
} from "../application/channel-agent-reply";
import type { ChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import type { ChannelSessionCommandClient } from "../application/channel-session.types";
import type { TelegramWorkTrigger } from "./telegram-events";
import {
  isTelegramCredentialScopedError,
  TelegramWebApiClient,
  TelegramWebApiError,
} from "./telegram-web-api";

export const TELEGRAM_FIRST_PARTY_ADAPTER_MANIFEST = {
  displayName: "Telegram",
  id: "telegram",
  requires: {
    auth: ["webhook_secret"],
    credentials: ["bot_token", "webhook_secret"],
  },
  surfaceType: "im",
  triggers: ["message", "channel_post"],
} as const;

export interface TelegramAdapterConfig {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  botToken: string;
  sessionLinkBaseUrl: string | null;
}

async function markBindingErrorIfCredentialScoped(input: {
  error: TelegramWebApiError;
  sessionClient: ChannelSessionCommandClient;
}): Promise<boolean> {
  if (!isTelegramCredentialScopedError(input.error)) {
    return false;
  }
  await input.sessionClient.markBindingError(input.error.code);
  return true;
}

function toMosooMessage(trigger: TelegramWorkTrigger): string {
  return [
    trigger.text,
    "",
    "---",
    "Source: Telegram message",
    `Telegram chat: ${trigger.chatId}`,
    `Telegram thread: ${trigger.externalThreadId}`,
    `Telegram user: ${trigger.userId ?? "unknown"}`,
  ].join("\n");
}

export async function processTelegramWorkTrigger(input: {
  config: TelegramAdapterConfig;
  finalDeliveryScheduler: ChannelFinalDeliveryScheduler;
  sessionClient: ChannelSessionCommandClient;
  trigger: TelegramWorkTrigger;
}): Promise<void> {
  const telegram = new TelegramWebApiClient(input.config.botToken);

  try {
    const sessionCommand = await input.sessionClient.createOrContinueSession({
      clientRequestId: input.trigger.eventId,
      text: toMosooMessage(input.trigger),
      trigger: {
        auditActorDisplay: `Telegram ${input.trigger.userId ?? input.trigger.chatId}`,
        auditActorId: input.trigger.userId ?? input.trigger.chatId,
        eventId: input.trigger.eventId,
        externalActorId: input.trigger.externalActorId,
        externalMessageId: input.trigger.externalMessageId,
        externalThreadId: input.trigger.externalThreadId,
        externalWorkspaceId: input.trigger.chatId,
        providerMetadata: {
          chat_id: input.trigger.chatId,
          chat_title: input.trigger.chatTitle,
          chat_type: input.trigger.chatType,
          message_id: input.trigger.messageId,
          message_thread_id: input.trigger.messageThreadId,
          user_display_name: input.trigger.userDisplayName,
          username: input.trigger.username,
        },
        requiresExistingSession: false,
      },
    });

    if (sessionCommand.duplicate || sessionCommand.ignored) {
      return;
    }

    const sessionId = sessionCommand.sessionId;

    if (!sessionId) {
      throw new Error("Telegram channel session command did not return a session id.");
    }

    const runId = sessionCommand.runId;

    if (!runId) {
      throw new Error("Telegram channel session command did not return a run id.");
    }

    const sessionLink = buildChannelSessionLink({
      agentId: input.config.agentId,
      sessionId,
      sessionLinkBaseUrl: input.config.sessionLinkBaseUrl,
    });
    await telegram.sendMessage({
      chatId: input.trigger.chatId,
      messageThreadId: input.trigger.messageThreadId,
      text: buildChannelWorkingText({ sessionLink }),
    });
    await input.finalDeliveryScheduler.enqueue({
      bindingId: input.config.bindingId,
      externalEventId: input.trigger.eventId,
      payload: {
        chatId: input.trigger.chatId,
        messageThreadId: input.trigger.messageThreadId,
        provider: "telegram",
      },
      provider: "telegram",
      runId,
      sessionId,
    });
  } catch (error) {
    if (error instanceof TelegramWebApiError) {
      const markedCredentialError = await markBindingErrorIfCredentialScoped({
        error,
        sessionClient: input.sessionClient,
      });
      if (markedCredentialError) {
        return;
      }
    }

    logChannelAdapterError("telegram-first-party-adapter.failed", error, {
      bindingId: input.config.bindingId,
      eventId: input.trigger.eventId,
    });

    try {
      await telegram.sendMessage({
        chatId: input.trigger.chatId,
        messageThreadId: input.trigger.messageThreadId,
        text: CHANNEL_AGENT_FAILURE_TEXT,
      });
    } catch (failureReplyError) {
      if (failureReplyError instanceof TelegramWebApiError) {
        await markBindingErrorIfCredentialScoped({
          error: failureReplyError,
          sessionClient: input.sessionClient,
        });
      }

      logChannelAdapterError(
        "telegram-first-party-adapter.failure_reply_failed",
        failureReplyError,
        {
          bindingId: input.config.bindingId,
          eventId: input.trigger.eventId,
        },
      );
    }
  }
}
