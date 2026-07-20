import { describe, expect, test } from "bun:test";

import type { ChannelFinalDeliveryMessage } from "../src/modules/channels/application/channel-final-delivery-message";
import {
  enqueueChannelFinalDeliveryJob,
  processChannelFinalDeliveryMessage,
} from "../src/modules/channels/application/channel-final-delivery.service";
import {
  createChannelSessionClient,
  resolveAgentChannelBindingContextById,
} from "../src/modules/channels/application/channel-session.service";
import { createWeChatContextTokenStoreKey } from "../src/modules/channels/wechat/wechat-runtime";
import {
  createWeChatPollingOwnerDatabaseStore,
  persistConfirmedWeChatQrPairing,
} from "../src/modules/channels/wechat/wechat-runtime-store";
import {
  createRecordedQueueMessage,
  createTestExecutionContext,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  createConfirmedWeChatQrSnapshot,
  createWeChatTestBindings,
  installWeChatSendFetch,
  insertCompletedWeChatAssistantReply,
  readChannelFinalDeliveryQueueStub,
  takeQueuedChannelFinalDeliveryMessageBody,
} from "./wechat-channel-connection-fixtures";
import type { WeChatSendRequest } from "./wechat-channel-connection-fixtures";

describe("WeChat channel final delivery", () => {
  test("durable final delivery sends WeChat replies through the stored context token", async () => {
    const sendRequests: WeChatSendRequest[] = [];
    const restoreFetch = installWeChatSendFetch(sendRequests);

    try {
      const bindings = await createWeChatTestBindings();
      const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        snapshot: createConfirmedWeChatQrSnapshot(),
      });
      const store = createWeChatPollingOwnerDatabaseStore(bindings);

      await store.writeContextToken({
        accountId: "account-1",
        bindingId: account.id,
        contextTokenKey: createWeChatContextTokenStoreKey({
          accountId: "account-1",
          bindingId: account.id,
          peerId: "peer-1",
        }),
        contextTokenValue: "ctx-final-secret",
        peerId: "peer-1",
        toUserId: "peer-1",
        updatedAtMs: nowMsForTest(),
      });
      await bindings.DB.prepare(
        "update wechat_channel_account set status = 'running', updated_at = ? where id = ?",
      )
        .bind(nowMsForTest(), account.id)
        .run();

      const binding = await resolveAgentChannelBindingContextById(bindings, {
        bindingId: account.id,
        provider: "wechat",
      });

      if (!binding) {
        throw new Error("Expected WeChat binding context.");
      }

      const sessionCommand = await createChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "scheduled://wechat-polling-owner",
      }).createOrContinueSession({
        clientRequestId: "wechat:message:final",
        text: "Review this WeChat message",
        trigger: {
          eventId: "wechat:message:final",
          externalActorId: "wechat:user:peer-1",
          externalMessageId: "peer-1:final",
          externalThreadId: "wechat:dm:peer-1",
          providerMetadata: {
            chatType: "dm",
            peerId: "peer-1",
          },
          requiresExistingSession: false,
        },
      });

      if (!sessionCommand.sessionId || !sessionCommand.runId) {
        throw new Error("Expected WeChat session command to create a session and run.");
      }

      await insertCompletedWeChatAssistantReply({
        bindings,
        messageId: "wechat-final-assistant-message",
        runId: sessionCommand.runId,
        seq: 2,
        sessionId: sessionCommand.sessionId,
        text: "Final answer from mosoo",
      });
      const jobId = await enqueueChannelFinalDeliveryJob(
        bindings,
        {
          bindingId: account.id,
          externalEventId: "wechat:message:final",
          payload: {
            peerId: "peer-1",
            provider: "wechat",
          },
          provider: "wechat",
          runId: sessionCommand.runId,
          sessionId: sessionCommand.sessionId,
        },
        nowMsForTest(),
      );

      if (!jobId) {
        throw new Error("Expected WeChat final delivery job to be queued.");
      }

      const queued = takeQueuedChannelFinalDeliveryMessageBody(bindings, jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await bindings.DB.prepare(
        "select status from channel_final_delivery_job where external_event_id = ?",
      )
        .bind("wechat:message:final")
        .first<{
          status: string;
        }>();
      expect(job).toEqual({
        status: "delivered",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(sendRequests).toHaveLength(1);
      expect(sendRequests[0]?.headers.get("Authorization")).toBe("Bearer bot-secret");
      expect(JSON.parse(sendRequests[0]?.body ?? "{}")).toMatchObject({
        msg: {
          context_token: "ctx-final-secret",
          item_list: [
            {
              text_item: {
                text: `mosoo session ${sessionCommand.sessionId}\n\nFinal answer from mosoo`,
              },
              type: 1,
            },
          ],
          to_user_id: "peer-1",
        },
      });
    } finally {
      restoreFetch();
    }
  });

  test("durable final delivery records typed WeChat reply errors without tokenless fallback", async () => {
    const sendRequests: WeChatSendRequest[] = [];
    const restoreFetch = installWeChatSendFetch(sendRequests);

    try {
      const bindings = await createWeChatTestBindings();
      const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        snapshot: createConfirmedWeChatQrSnapshot(),
      });
      await bindings.DB.prepare(
        "update wechat_channel_account set status = 'running', updated_at = ? where id = ?",
      )
        .bind(nowMsForTest(), account.id)
        .run();

      const binding = await resolveAgentChannelBindingContextById(bindings, {
        bindingId: account.id,
        provider: "wechat",
      });

      if (!binding) {
        throw new Error("Expected WeChat binding context.");
      }

      const sessionCommand = await createChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "scheduled://wechat-polling-owner",
      }).createOrContinueSession({
        clientRequestId: "wechat:message:missing-context",
        text: "Review this WeChat message",
        trigger: {
          eventId: "wechat:message:missing-context",
          externalActorId: "wechat:user:peer-1",
          externalMessageId: "peer-1:missing-context",
          externalThreadId: "wechat:dm:peer-1",
          providerMetadata: {
            chatType: "dm",
            peerId: "peer-1",
          },
          requiresExistingSession: false,
        },
      });

      if (!sessionCommand.sessionId || !sessionCommand.runId) {
        throw new Error("Expected WeChat session command to create a session and run.");
      }

      await insertCompletedWeChatAssistantReply({
        bindings,
        messageId: "wechat-missing-context-assistant-message",
        runId: sessionCommand.runId,
        seq: 2,
        sessionId: sessionCommand.sessionId,
        text: "Final answer without a stored context token",
      });
      const jobId = await enqueueChannelFinalDeliveryJob(
        bindings,
        {
          bindingId: account.id,
          externalEventId: "wechat:message:missing-context",
          payload: {
            peerId: "peer-1",
            provider: "wechat",
          },
          provider: "wechat",
          runId: sessionCommand.runId,
          sessionId: sessionCommand.sessionId,
        },
        nowMsForTest(),
      );

      if (!jobId) {
        throw new Error("Expected WeChat final delivery job to be queued.");
      }

      const queued = takeQueuedChannelFinalDeliveryMessageBody(bindings, jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await bindings.DB.prepare(
        [
          "select attempt_count, last_error_code, status",
          "from channel_final_delivery_job where external_event_id = ?",
        ].join(" "),
      )
        .bind("wechat:message:missing-context")
        .first<{
          attempt_count: number;
          last_error_code: string | null;
          status: string;
        }>();

      expect(job).toMatchObject({
        attempt_count: 1,
        last_error_code: "context_token_not_found",
        status: "dispatched",
      });
      const queue = readChannelFinalDeliveryQueueStub(bindings);
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent.at(-1)).toEqual({
        body: { jobId },
        contentType: "json",
        delaySeconds: 60,
        id: "queued-2",
      });
      expect(sendRequests).toHaveLength(0);
    } finally {
      restoreFetch();
    }
  });
});
