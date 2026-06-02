import type { AgentId, ChannelBindingId } from "@mosoo/id";

import { logChannelAdapterError } from "../application/channel-adapter-logger";
import {
  CHANNEL_AGENT_FAILURE_TEXT,
  buildChannelSessionLink,
  buildChannelWorkingText,
} from "../application/channel-agent-reply";
import type { ChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import type { ChannelSessionCommandClient } from "../application/channel-session.types";
import type { DiscordWorkTrigger } from "./discord-events";
import { DiscordWebApiClient, DiscordWebApiError } from "./discord-web-api";

export const DISCORD_FIRST_PARTY_ADAPTER_MANIFEST = {
  displayName: "Discord",
  id: "discord",
  requires: {
    auth: ["relay_signature"],
    credentials: ["application_id", "bot_token", "relay_secret"],
  },
  surfaceType: "im",
  triggers: ["MESSAGE_CREATE"],
} as const;

export interface DiscordAdapterConfig {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  botToken: string;
  sessionLinkBaseUrl: string | null;
}

export type DiscordWorkTriggerProcessResult =
  | {
      ok: true;
    }
  | {
      code: "discord_work_trigger_failed";
      ok: false;
    };

function shouldMarkBindingError(error: DiscordWebApiError): boolean {
  const code = error.code.toLowerCase();

  return (
    code.includes("401") ||
    code.includes("invalid token") ||
    code.includes("unauthorized") ||
    code.includes("token")
  );
}

async function markBindingErrorIfCredentialScoped(input: {
  error: DiscordWebApiError;
  sessionClient: ChannelSessionCommandClient;
}): Promise<void> {
  if (!shouldMarkBindingError(input.error)) {
    return;
  }

  await input.sessionClient.markBindingError(input.error.code);
}

function toMosooMessage(trigger: DiscordWorkTrigger): string {
  return [
    trigger.text,
    "",
    "---",
    "Source: Discord message",
    `Discord channel: ${trigger.channelId}`,
    `Discord guild: ${trigger.guildId ?? "dm"}`,
    `Discord thread: ${trigger.externalThreadId}`,
    `Discord user: ${trigger.authorId}`,
  ].join("\n");
}

export async function processDiscordWorkTrigger(input: {
  config: DiscordAdapterConfig;
  finalDeliveryScheduler: ChannelFinalDeliveryScheduler;
  sessionClient: ChannelSessionCommandClient;
  trigger: DiscordWorkTrigger;
}): Promise<DiscordWorkTriggerProcessResult> {
  const discord = new DiscordWebApiClient(input.config.botToken);

  try {
    const sessionCommand = await input.sessionClient.createOrContinueSession({
      clientRequestId: input.trigger.eventId,
      text: toMosooMessage(input.trigger),
      trigger: {
        auditActorDisplay: `Discord ${input.trigger.authorDisplayName ?? input.trigger.authorId}`,
        auditActorId: input.trigger.authorId,
        eventId: input.trigger.eventId,
        externalActorId: input.trigger.externalActorId,
        externalMessageId: input.trigger.externalMessageId,
        externalThreadId: input.trigger.externalThreadId,
        externalWorkspaceId: input.trigger.guildId ?? input.trigger.channelId,
        providerMetadata: {
          author_display_name: input.trigger.authorDisplayName,
          channel_id: input.trigger.channelId,
          channel_type: input.trigger.channelType,
          guild_id: input.trigger.guildId,
          message_id: input.trigger.messageId,
        },
        requiresExistingSession: false,
      },
    });

    if (sessionCommand.duplicate || sessionCommand.ignored) {
      return { ok: true };
    }

    const sessionId = sessionCommand.sessionId;

    if (!sessionId) {
      throw new Error("Discord channel session command did not return a session id.");
    }

    const runId = sessionCommand.runId;

    if (!runId) {
      throw new Error("Discord channel session command did not return a run id.");
    }

    const sessionLink = buildChannelSessionLink({
      agentId: input.config.agentId,
      sessionId,
      sessionLinkBaseUrl: input.config.sessionLinkBaseUrl,
    });
    const workingMessage = await discord.sendMessage({
      channelId: input.trigger.channelId,
      text: buildChannelWorkingText({ sessionLink }),
    });
    await input.finalDeliveryScheduler.enqueue({
      bindingId: input.config.bindingId,
      externalEventId: input.trigger.eventId,
      payload: {
        channelId: input.trigger.channelId,
        provider: "discord",
        workingMessage,
      },
      provider: "discord",
      runId,
      sessionId,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof DiscordWebApiError) {
      await markBindingErrorIfCredentialScoped({
        error,
        sessionClient: input.sessionClient,
      });
    }

    logChannelAdapterError("discord-first-party-adapter.failed", error, {
      bindingId: input.config.bindingId,
      eventId: input.trigger.eventId,
    });

    try {
      await discord.sendMessage({
        channelId: input.trigger.channelId,
        text: CHANNEL_AGENT_FAILURE_TEXT,
      });
    } catch (failureReplyError) {
      if (failureReplyError instanceof DiscordWebApiError) {
        await markBindingErrorIfCredentialScoped({
          error: failureReplyError,
          sessionClient: input.sessionClient,
        });
      }

      logChannelAdapterError(
        "discord-first-party-adapter.failure_reply_failed",
        failureReplyError,
        {
          bindingId: input.config.bindingId,
          eventId: input.trigger.eventId,
        },
      );
    }

    return { code: "discord_work_trigger_failed", ok: false };
  }
}
