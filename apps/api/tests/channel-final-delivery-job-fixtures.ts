import { sessionMessagesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import {
  createDiscordAgentChannelBinding,
  createLarkAgentChannelBinding,
  createTelegramAgentChannelBinding,
} from "../src/modules/channels/application/agent-channel-binding.service";
import { enqueueChannelFinalDeliveryJob } from "../src/modules/channels/application/channel-final-delivery.service";
import {
  createChannelSessionClient,
  resolveAgentChannelBindingContextById,
} from "../src/modules/channels/application/channel-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import type { PublicHttpContractDatabase } from "./channel-final-delivery-fetch-fixtures";
import { OWNER_VIEWER } from "./channel-final-delivery-fetch-fixtures";
import {
  createTestExecutionContext,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

interface CompletedFinalDeliveryJob {
  bindingId: string;
  jobId: string;
  runId: string;
  sessionId: string;
}

export async function createCompletedTelegramFinalDeliveryJob(input: {
  bindings: ApiBindings;
  database: PublicHttpContractDatabase;
  externalEventId: string;
}): Promise<CompletedFinalDeliveryJob> {
  const binding = await createTelegramAgentChannelBinding(input.bindings, OWNER_VIEWER, {
    agentId: PUBLIC_API_TEST_IDS.agent,
    botToken: "telegram-token",
    appId: PUBLIC_API_TEST_IDS.app,
    webhookSecret: "telegram-webhook-secret",
  });
  const context = await resolveAgentChannelBindingContextById(input.bindings, {
    bindingId: binding.id,
    provider: "telegram",
  });

  if (!context) {
    throw new Error("Expected Telegram binding context.");
  }

  const sessionCommand = await createChannelSessionClient({
    binding: context,
    bindings: input.bindings,
    executionContext: createTestExecutionContext(),
    requestUrl: "https://api.example.com/api/v1/channels/telegram/events/binding",
  }).createOrContinueSession({
    clientRequestId: input.externalEventId,
    text: "Review this",
    trigger: {
      eventId: input.externalEventId,
      externalActorId: "telegram:user:42",
      externalMessageId: `${input.externalEventId}:message`,
      externalThreadId: "42:main",
      providerMetadata: {
        chat_id: "42",
        message_id: 77,
      },
      requiresExistingSession: false,
    },
  });

  if (!sessionCommand.sessionId) {
    throw new Error("Expected channel session id.");
  }

  if (!sessionCommand.runId) {
    throw new Error("Expected channel run id.");
  }

  await insertCompletedAssistantReply({
    database: input.database,
    messageId: `${input.externalEventId}:assistant-message-final`,
    runId: sessionCommand.runId,
    seq: 2,
    sessionId: sessionCommand.sessionId,
    text: "Final answer",
  });
  const jobId = await enqueueChannelFinalDeliveryJob(
    input.bindings,
    {
      bindingId: binding.id,
      externalEventId: input.externalEventId,
      payload: {
        chatId: "42",
        messageThreadId: null,
        provider: "telegram",
      },
      provider: "telegram",
      runId: sessionCommand.runId,
      sessionId: sessionCommand.sessionId,
    },
    nowMsForTest(),
  );

  if (!jobId) {
    throw new Error("Expected Telegram final delivery job to be queued.");
  }

  return {
    bindingId: binding.id,
    jobId,
    runId: sessionCommand.runId,
    sessionId: sessionCommand.sessionId,
  };
}

export async function createCompletedDiscordFinalDeliveryJob(input: {
  bindings: ApiBindings;
  database: PublicHttpContractDatabase;
  externalEventId: string;
}): Promise<CompletedFinalDeliveryJob> {
  const binding = await createDiscordAgentChannelBinding(input.bindings, OWNER_VIEWER, {
    agentId: PUBLIC_API_TEST_IDS.agent,
    applicationId: "discord-app-1",
    botToken: "discord-token",
    appId: PUBLIC_API_TEST_IDS.app,
    relaySecret: "discord-relay-secret",
  });
  const context = await resolveAgentChannelBindingContextById(input.bindings, {
    bindingId: binding.id,
    provider: "discord",
  });

  if (!context) {
    throw new Error("Expected Discord binding context.");
  }

  const sessionCommand = await createChannelSessionClient({
    binding: context,
    bindings: input.bindings,
    executionContext: createTestExecutionContext(),
    requestUrl: "https://api.example.com/api/v1/channels/discord/events/binding",
  }).createOrContinueSession({
    clientRequestId: input.externalEventId,
    text: "Review this",
    trigger: {
      eventId: input.externalEventId,
      externalActorId: "discord:user:discord-user-1",
      externalMessageId: "discord-channel-1:message-1",
      externalThreadId: "dm:discord-channel-1",
      providerMetadata: {
        channel_id: "discord-channel-1",
        message_id: "message-1",
      },
      requiresExistingSession: false,
    },
  });

  if (!sessionCommand.sessionId) {
    throw new Error("Expected channel session id.");
  }

  if (!sessionCommand.runId) {
    throw new Error("Expected channel run id.");
  }

  await insertCompletedAssistantReply({
    database: input.database,
    messageId: `${input.externalEventId}:assistant-message-final`,
    runId: sessionCommand.runId,
    seq: 2,
    sessionId: sessionCommand.sessionId,
    text: "Final answer",
  });
  const jobId = await enqueueChannelFinalDeliveryJob(
    input.bindings,
    {
      bindingId: binding.id,
      externalEventId: input.externalEventId,
      payload: {
        channelId: "discord-channel-1",
        provider: "discord",
        workingMessage: {
          channelId: "discord-channel-1",
          messageId: "working-message-1",
        },
      },
      provider: "discord",
      runId: sessionCommand.runId,
      sessionId: sessionCommand.sessionId,
    },
    nowMsForTest(),
  );

  if (!jobId) {
    throw new Error("Expected Discord final delivery job to be queued.");
  }

  return {
    bindingId: binding.id,
    jobId,
    runId: sessionCommand.runId,
    sessionId: sessionCommand.sessionId,
  };
}

export async function createCompletedLarkFinalDeliveryJob(input: {
  bindings: ApiBindings;
  database: PublicHttpContractDatabase;
  externalEventId: string;
}): Promise<CompletedFinalDeliveryJob> {
  const binding = await createLarkAgentChannelBinding(input.bindings, OWNER_VIEWER, {
    agentId: PUBLIC_API_TEST_IDS.agent,
    larkAppId: "cli_a",
    appSecret: "secret",
    connectionMode: "webhook",
    domain: "feishu",
    encryptKey: "encrypt-key",
    appId: PUBLIC_API_TEST_IDS.app,
    verificationToken: "verification-token",
  });
  const context = await resolveAgentChannelBindingContextById(input.bindings, {
    bindingId: binding.id,
    provider: "lark",
  });

  if (!context) {
    throw new Error("Expected Lark binding context.");
  }

  const sessionCommand = await createChannelSessionClient({
    binding: context,
    bindings: input.bindings,
    executionContext: createTestExecutionContext(),
    requestUrl: "https://api.example.com/api/v1/channels/lark/events/binding",
  }).createOrContinueSession({
    clientRequestId: input.externalEventId,
    text: "Review this",
    trigger: {
      eventId: input.externalEventId,
      externalActorId: "lark:ou_alice",
      externalMessageId: "om_message",
      externalThreadId: "oc_chat:om_root",
      providerMetadata: {
        chat_id: "oc_chat",
        message_id: "om_message",
      },
      requiresExistingSession: false,
    },
  });

  if (!sessionCommand.sessionId) {
    throw new Error("Expected channel session id.");
  }

  if (!sessionCommand.runId) {
    throw new Error("Expected channel run id.");
  }

  await insertCompletedAssistantReply({
    database: input.database,
    messageId: `${input.externalEventId}:assistant-message-final`,
    runId: sessionCommand.runId,
    seq: 2,
    sessionId: sessionCommand.sessionId,
    text: "Final answer",
  });
  const jobId = await enqueueChannelFinalDeliveryJob(
    input.bindings,
    {
      bindingId: binding.id,
      externalEventId: input.externalEventId,
      payload: {
        messageId: "om_message",
        provider: "lark",
      },
      provider: "lark",
      runId: sessionCommand.runId,
      sessionId: sessionCommand.sessionId,
    },
    nowMsForTest(),
  );

  if (!jobId) {
    throw new Error("Expected Lark final delivery job to be queued.");
  }

  return {
    bindingId: binding.id,
    jobId,
    runId: sessionCommand.runId,
    sessionId: sessionCommand.sessionId,
  };
}

async function insertCompletedAssistantReply(input: {
  database: PublicHttpContractDatabase;
  messageId: string;
  runId: string;
  seq: number;
  sessionId: string;
  text: string;
}): Promise<void> {
  await input.database
    .app()
    .update(sessionRunsTable)
    .set({
      completedAt: nowMsForTest(),
      status: "completed",
      updatedAt: nowMsForTest(),
    })
    .where(eq(sessionRunsTable.id, input.runId))
    .run();
  await input.database
    .app()
    .insert(sessionMessagesTable)
    .values({
      contentText: input.text,
      createdAt: nowMsForTest(),
      createdByAccountId: "01J00000000000000000000001",
      id: input.messageId,
      planJson: null,
      role: "assistant",
      segmentsJson: null,
      seq: input.seq,
      sessionId: input.sessionId,
      sessionRunId: input.runId,
    })
    .run();
  await input.database
    .app()
    .update(sessionsTable)
    .set({
      lastRunId: input.runId,
      status: "IDLE",
      updatedAt: nowMsForTest(),
    })
    .where(eq(sessionsTable.id, input.sessionId))
    .run();
}
