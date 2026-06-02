import type { AgentId, ChannelBindingId, SessionId, SessionRunId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";
import {
  CHANNEL_AGENT_FAILURE_TEXT,
  buildChannelSessionLink,
  buildChannelWorkingText,
} from "../application/channel-agent-reply";
import type { ChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import { logSlackAdapterError } from "./slack-adapter-logger";
import type { SlackAgentReplyPollClient } from "./slack-agent-reply";
import type { SlackWorkTrigger } from "./slack-events";
import { SlackWebApiClient, SlackWebApiError } from "./slack-web-api";
import type { SlackMessageReference } from "./slack-web-api";

export const SLACK_FIRST_PARTY_ADAPTER_MANIFEST = {
  activityModels: ["thread_reply"],
  contextModels: ["im_thread"],
  displayName: "Slack",
  id: "slack",
  identityModels: ["bot_user"],
  requires: {
    auth: ["bot_install"],
    credentials: ["bot_token", "signing_secret"],
  },
  surfaceType: "im",
  toolModels: ["mcp_only"],
  triggers: ["app_mention", "channel_thread_message", "dm_received"],
} as const;

export interface SlackAdapterConfig {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  sessionLinkBaseUrl: string | null;
  slackBotToken: string;
}

export interface SlackSessionCommandClient extends SlackAgentReplyPollClient {
  createOrContinueSession(input: {
    clientRequestId: string;
    text: string;
    trigger: SlackWorkTrigger;
  }): Promise<{
    duplicate: boolean;
    ignored?: boolean;
    runId: SessionRunId | null;
    sessionId: SessionId | null;
  }>;
  markBindingError(errorCode: string): Promise<void>;
}

function toMosooMessage(trigger: SlackWorkTrigger): string {
  return [
    isTruthy(trigger.text) ? trigger.text : "(no text)",
    "",
    "---",
    `Source: Slack ${trigger.triggerType}`,
    `Slack team: ${trigger.teamId ?? "unknown"}`,
    `Slack channel: ${trigger.channelId}`,
    `Slack thread: ${trigger.threadTs}`,
    `Slack user: ${trigger.userId}`,
  ].join("\n");
}

function shouldMarkBindingError(error: SlackWebApiError): boolean {
  return (
    error.code === "account_inactive" ||
    error.code === "invalid_auth" ||
    error.code === "missing_scope" ||
    error.code === "not_authed" ||
    error.code === "token_revoked"
  );
}

async function markBindingErrorIfCredentialScoped(input: {
  error: SlackWebApiError;
  sessionClient: SlackSessionCommandClient;
}): Promise<void> {
  if (!shouldMarkBindingError(input.error)) {
    return;
  }

  await input.sessionClient.markBindingError(input.error.code);
}

async function writeSlackFinalReply(input: {
  channelId: string;
  slack: SlackWebApiClient;
  text: string;
  threadTs: string;
  workingMessage: SlackMessageReference | null;
}): Promise<void> {
  if (input.workingMessage) {
    await input.slack.updateMessage({
      channelId: input.workingMessage.channelId,
      text: input.text,
      ts: input.workingMessage.ts,
    });
    return;
  }

  await input.slack.postChatMessage({
    channelId: input.channelId,
    text: input.text,
    threadTs: input.threadTs,
  });
}

export async function processSlackWorkTrigger(input: {
  config: SlackAdapterConfig;
  finalDeliveryScheduler: ChannelFinalDeliveryScheduler;
  sessionClient: SlackSessionCommandClient;
  trigger: SlackWorkTrigger;
}): Promise<void> {
  const slack = new SlackWebApiClient(input.config.slackBotToken);
  let workingMessage: SlackMessageReference | null = null;

  try {
    const sessionCommand = await input.sessionClient.createOrContinueSession({
      clientRequestId: `slack:event:${input.trigger.eventId}`,
      text: toMosooMessage(input.trigger),
      trigger: input.trigger,
    });

    if (sessionCommand.duplicate || sessionCommand.ignored) {
      return;
    }

    const sessionId = sessionCommand.sessionId;

    if (!sessionId) {
      throw new Error("Slack channel session command did not return a session id.");
    }

    const runId = sessionCommand.runId;

    if (!runId) {
      throw new Error("Slack channel session command did not return a run id.");
    }

    const sessionLink = buildChannelSessionLink({
      agentId: input.config.agentId,
      sessionId,
      sessionLinkBaseUrl: input.config.sessionLinkBaseUrl,
    });
    workingMessage = await slack.postChatMessage({
      channelId: input.trigger.channelId,
      text: buildChannelWorkingText({ linkLabel: sessionId, sessionLink }),
      threadTs: input.trigger.threadTs,
    });
    await input.finalDeliveryScheduler.enqueue({
      bindingId: input.config.bindingId,
      externalEventId: `slack:event:${input.trigger.eventId}`,
      payload: {
        channelId: input.trigger.channelId,
        provider: "slack",
        threadTs: input.trigger.threadTs,
        workingMessage,
      },
      provider: "slack",
      runId,
      sessionId,
    });
  } catch (error) {
    if (error instanceof SlackWebApiError) {
      await markBindingErrorIfCredentialScoped({
        error,
        sessionClient: input.sessionClient,
      });
    }

    logSlackAdapterError("slack-first-party-adapter.failed", error, {
      bindingId: input.config.bindingId,
      channelId: input.trigger.channelId,
      eventId: input.trigger.eventId,
      teamId: input.trigger.teamId,
      triggerType: input.trigger.triggerType,
    });

    try {
      await writeSlackFinalReply({
        channelId: input.trigger.channelId,
        slack,
        text: CHANNEL_AGENT_FAILURE_TEXT,
        threadTs: input.trigger.threadTs,
        workingMessage,
      });
    } catch (failureReplyError) {
      if (failureReplyError instanceof SlackWebApiError) {
        await markBindingErrorIfCredentialScoped({
          error: failureReplyError,
          sessionClient: input.sessionClient,
        });
      }

      logSlackAdapterError("slack-first-party-adapter.failure_reply_failed", failureReplyError, {
        bindingId: input.config.bindingId,
        channelId: input.trigger.channelId,
        eventId: input.trigger.eventId,
        teamId: input.trigger.teamId,
        triggerType: input.trigger.triggerType,
      });
    }
  }
}
