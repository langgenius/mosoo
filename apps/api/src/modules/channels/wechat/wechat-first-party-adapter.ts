import type { AgentId, ChannelBindingId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { logChannelAdapterError } from "../application/channel-adapter-logger";
import {
  CHANNEL_AGENT_FAILURE_TEXT,
  buildChannelSessionLink,
  buildChannelWorkingText,
} from "../application/channel-agent-reply";
import type { ChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import type { ChannelSessionCommandClient } from "../application/channel-session.types";
import { createWeChatProviderMetadata } from "./wechat-events";
import type { WeChatIlinkWorkTrigger } from "./wechat-events";
import { sendWeChatStoredContextReply } from "./wechat-reply.service";

export interface WeChatAdapterConfig {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  sessionLinkBaseUrl: string | null;
}

function toMosooMessage(trigger: WeChatIlinkWorkTrigger): string {
  return [
    trigger.text,
    "",
    "---",
    "Source: Personal WeChat DM",
    `WeChat peer: ${trigger.peerId}`,
    `WeChat thread: ${trigger.externalThreadId}`,
  ].join("\n");
}

export async function processWeChatWorkTrigger(input: {
  bindings: ApiBindings;
  config: WeChatAdapterConfig;
  finalDeliveryScheduler: ChannelFinalDeliveryScheduler;
  sessionClient: ChannelSessionCommandClient;
  trigger: WeChatIlinkWorkTrigger;
}): Promise<void> {
  try {
    const sessionCommand = await input.sessionClient.createOrContinueSession({
      clientRequestId: input.trigger.eventId,
      text: toMosooMessage(input.trigger),
      trigger: {
        eventId: input.trigger.eventId,
        externalActorId: input.trigger.externalActorId,
        externalMessageId: input.trigger.externalMessageId,
        externalThreadId: input.trigger.externalThreadId,
        externalWorkspaceId: input.trigger.peerId,
        providerMetadata: createWeChatProviderMetadata(input.trigger),
        requiresExistingSession: false,
      },
    });

    if (sessionCommand.duplicate || sessionCommand.ignored) {
      return;
    }

    const sessionId = sessionCommand.sessionId;

    if (!sessionId) {
      throw new Error("WeChat channel session command did not return a session id.");
    }

    const runId = sessionCommand.runId;

    if (!runId) {
      throw new Error("WeChat channel session command did not return a run id.");
    }

    await input.finalDeliveryScheduler.enqueue({
      bindingId: input.config.bindingId,
      externalEventId: input.trigger.eventId,
      payload: {
        peerId: input.trigger.peerId,
        provider: "wechat",
      },
      provider: "wechat",
      runId,
      sessionId,
    });

    try {
      const sessionLink = buildChannelSessionLink({
        agentId: input.config.agentId,
        sessionId,
        sessionLinkBaseUrl: input.config.sessionLinkBaseUrl,
      });
      await sendWeChatStoredContextReply(input.bindings, {
        accountId: input.config.bindingId,
        peerId: input.trigger.peerId,
        text: buildChannelWorkingText({ sessionLink }),
      });
    } catch (workingReplyError) {
      logChannelAdapterError("wechat-first-party-adapter.working_reply_failed", workingReplyError, {
        bindingId: input.config.bindingId,
        eventId: input.trigger.eventId,
      });
    }
  } catch (error) {
    logChannelAdapterError("wechat-first-party-adapter.failed", error, {
      bindingId: input.config.bindingId,
      eventId: input.trigger.eventId,
    });

    try {
      await sendWeChatStoredContextReply(input.bindings, {
        accountId: input.config.bindingId,
        peerId: input.trigger.peerId,
        text: CHANNEL_AGENT_FAILURE_TEXT,
      });
    } catch (failureReplyError) {
      logChannelAdapterError("wechat-first-party-adapter.failure_reply_failed", failureReplyError, {
        bindingId: input.config.bindingId,
        eventId: input.trigger.eventId,
      });
    }

    throw error;
  }
}
