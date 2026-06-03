import type { AgentId, ChannelBindingId } from "@mosoo/id";

import { logChannelAdapterError } from "../application/channel-adapter-logger";
import {
  CHANNEL_AGENT_FAILURE_TEXT,
  buildChannelSessionLink,
  buildChannelWorkingText,
} from "../application/channel-agent-reply";
import type { ChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import type { ChannelSessionCommandClient } from "../application/channel-session.types";
import type { LarkConnectionMode } from "./lark-credentials";
import { LARK_EVENT_TYPE_RECEIVE_MESSAGE } from "./lark-events";
import type { LarkDomain, LarkWorkTrigger } from "./lark-events";
import { isLarkCredentialScopedError, LarkWebApiClient, LarkWebApiError } from "./lark-web-api";

export const LARK_FIRST_PARTY_ADAPTER_MANIFEST = {
  displayName: "Lark / Feishu",
  id: "lark",
  requires: {
    auth: ["signing"],
    credentials: ["app_id", "app_secret", "connection_mode"],
    webhookCredentials: ["verification_token", "encrypt_key"],
  },
  surfaceType: "im",
  triggers: [LARK_EVENT_TYPE_RECEIVE_MESSAGE],
} as const;

export interface LarkAdapterConfig {
  agentId: AgentId;
  appId: string;
  appSecret: string;
  bindingId: ChannelBindingId;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  sessionLinkBaseUrl: string | null;
}

function toMosooMessage(trigger: LarkWorkTrigger): string {
  return [
    trigger.text,
    "",
    "---",
    "Source: Lark / Feishu message",
    `Lark chat: ${trigger.chatId}`,
    `Lark thread: ${trigger.externalThreadId}`,
    `Lark sender: ${trigger.senderOpenId}`,
  ].join("\n");
}

export async function processLarkWorkTrigger(input: {
  config: LarkAdapterConfig;
  finalDeliveryScheduler: ChannelFinalDeliveryScheduler;
  sessionClient: ChannelSessionCommandClient;
  trigger: LarkWorkTrigger;
}): Promise<void> {
  const lark = new LarkWebApiClient({
    appId: input.config.appId,
    appSecret: input.config.appSecret,
    domain: input.config.domain,
  });

  try {
    const sessionCommand = await input.sessionClient.createOrContinueSession({
      clientRequestId: input.trigger.eventId,
      text: toMosooMessage(input.trigger),
      trigger: {
        eventId: input.trigger.eventId,
        externalActorId: input.trigger.externalActorId,
        externalMessageId: input.trigger.externalMessageId,
        externalThreadId: input.trigger.externalThreadId,
        externalWorkspaceId: input.trigger.tenantKey,
        providerMetadata: {
          chat_id: input.trigger.chatId,
          chat_type: input.trigger.chatType,
          connection_mode: input.config.connectionMode,
          message_id: input.trigger.messageId,
          parent_id: input.trigger.parentId,
          root_id: input.trigger.rootId,
          sender_open_id: input.trigger.senderOpenId,
          sender_type: input.trigger.senderType,
          sender_union_id: input.trigger.senderUnionId,
          sender_user_id: input.trigger.senderUserId,
          tenant_key: input.trigger.tenantKey,
        },
        requiresExistingSession: false,
      },
    });

    if (sessionCommand.duplicate || sessionCommand.ignored) {
      return;
    }

    const sessionId = sessionCommand.sessionId;

    if (!sessionId) {
      throw new Error("Lark channel session command did not return a session id.");
    }

    const runId = sessionCommand.runId;

    if (!runId) {
      throw new Error("Lark channel session command did not return a run id.");
    }

    const tenantAccessToken = await lark.getTenantAccessToken();
    const sessionLink = buildChannelSessionLink({
      agentId: input.config.agentId,
      sessionId,
      sessionLinkBaseUrl: input.config.sessionLinkBaseUrl,
    });
    await lark.replyMessage({
      messageId: input.trigger.messageId,
      tenantAccessToken,
      text: buildChannelWorkingText({ sessionLink }),
    });
    await input.finalDeliveryScheduler.enqueue({
      bindingId: input.config.bindingId,
      externalEventId: input.trigger.eventId,
      payload: {
        messageId: input.trigger.messageId,
        provider: "lark",
      },
      provider: "lark",
      runId,
      sessionId,
    });
  } catch (error) {
    const credentialScopedError =
      error instanceof LarkWebApiError && isLarkCredentialScopedError(error);

    if (credentialScopedError) {
      await input.sessionClient.markBindingError(error.code);
    }

    logChannelAdapterError("lark-first-party-adapter.failed", error, {
      bindingId: input.config.bindingId,
      eventId: input.trigger.eventId,
    });

    if (credentialScopedError) {
      return;
    }

    try {
      const tenantAccessToken = await lark.getTenantAccessToken();
      await lark.replyMessage({
        messageId: input.trigger.messageId,
        tenantAccessToken,
        text: CHANNEL_AGENT_FAILURE_TEXT,
      });
    } catch (failureReplyError) {
      if (
        failureReplyError instanceof LarkWebApiError &&
        isLarkCredentialScopedError(failureReplyError)
      ) {
        await input.sessionClient.markBindingError(failureReplyError.code);
      }

      logChannelAdapterError("lark-first-party-adapter.failure_reply_failed", failureReplyError, {
        bindingId: input.config.bindingId,
        eventId: input.trigger.eventId,
      });
    }
  }
}
