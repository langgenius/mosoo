import { describe, expect, test } from "bun:test";

import {
  pollWeChatChannelAccountOnce,
  runWeChatPollingOwnerMaintenance,
} from "../src/modules/channels/application/wechat-polling-owner-maintenance.service";
import { persistConfirmedWeChatQrPairing } from "../src/modules/channels/wechat/wechat-runtime-store";
import {
  createTestExecutionContext,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  createConfirmedWeChatQrSnapshot,
  createWeChatDmMessage,
  createWeChatTestBindings,
  installWeChatSendFetch,
} from "./wechat-channel-connection-fixtures";
import type { WeChatSendRequest } from "./wechat-channel-connection-fixtures";

describe("WeChat channel polling maintenance", () => {
  test("scheduled maintenance polls active WeChat accounts through the channel session spine", async () => {
    const sendRequests: WeChatSendRequest[] = [];
    const restoreFetch = installWeChatSendFetch(sendRequests);

    try {
      const bindings = await createWeChatTestBindings();
      const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        snapshot: createConfirmedWeChatQrSnapshot(),
      });
      let nowMs = nowMsForTest();

      const result = await runWeChatPollingOwnerMaintenance(bindings, new Date(nowMsForTest()), {
        clientFactory: ({ credentials }) => {
          expect(credentials).toMatchObject({
            botToken: "bot-secret",
            ilinkUserId: "account-1",
          });

          return {
            getUpdates: async ({ cursor }) => {
              expect(cursor).toBe("");

              return JSON.stringify({
                get_updates_buf: "cursor-next",
                msgs: [
                  createWeChatDmMessage({
                    contextToken: "ctx-secret",
                    messageId: 123,
                    text: "hello from wechat",
                  }),
                ],
                ret: 0,
              });
            },
          };
        },
        executionContext: createTestExecutionContext(),
        nowMs: () => {
          nowMs += 100;
          return nowMs;
        },
      });

      expect(result).toEqual({
        failed: 0,
        polled: 1,
        skipped: 0,
        total: 1,
      });

      const session = await bindings.DB.prepare(
        "select attributed_user_id, metadata_json, type from session where agent_id = ?",
      )
        .bind("01J00000000000000000000009")
        .first<{ attributed_user_id: string | null; metadata_json: string; type: string }>();
      expect(session).toMatchObject({
        attributed_user_id: null,
        type: "api_channel",
      });
      expect(JSON.parse(session?.metadata_json ?? "{}")).toMatchObject({
        triggered_by: {
          binding_id: account.id,
          external_actor_id: "wechat:user:peer-1",
          external_thread_id: "wechat:dm:peer-1",
          provider: "wechat",
          provider_metadata: {
            chatType: "dm",
            peerId: "peer-1",
          },
        },
      });

      const finalDeliveryJob = await bindings.DB.prepare(
        "select payload_json, provider, status from channel_final_delivery_job where provider = 'wechat'",
      ).first<{ payload_json: string; provider: string; status: string }>();
      expect(finalDeliveryJob).toMatchObject({
        provider: "wechat",
        status: "dispatched",
      });
      expect(JSON.parse(finalDeliveryJob?.payload_json ?? "{}")).toMatchObject({
        peerId: "peer-1",
        provider: "wechat",
      });

      const runtimeState = await bindings.DB.prepare(
        [
          "select lease_owner_id, runtime_state_json, status",
          "from channel_runtime_state",
          "where provider = 'wechat' and binding_id = ?",
        ].join(" "),
      )
        .bind(account.id)
        .first<{ lease_owner_id: string | null; runtime_state_json: string; status: string }>();
      expect(runtimeState).toMatchObject({
        lease_owner_id: null,
        status: "running",
      });
      expect(runtimeState?.runtime_state_json).toContain("cursor-next");
      expect(runtimeState?.runtime_state_json).not.toContain("ctx-secret");

      const accountState = await bindings.DB.prepare(
        "select cursor, status from wechat_channel_account where id = ?",
      )
        .bind(account.id)
        .first<{ cursor: string; status: string }>();
      expect(accountState).toEqual({
        cursor: "cursor-next",
        status: "running",
      });

      expect(sendRequests).toHaveLength(1);
      expect(sendRequests[0]?.headers.get("Authorization")).toBe("Bearer bot-secret");
      expect(JSON.parse(sendRequests[0]?.body ?? "{}")).toMatchObject({
        msg: {
          context_token: "ctx-secret",
          item_list: [
            {
              text_item: {
                text: expect.stringContaining("Agent is working"),
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

  test("scheduled maintenance retries WeChat accounts stuck in failed status", async () => {
    const bindings = await createWeChatTestBindings();
    const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot(),
    });

    // Failed rows must remain poll candidates after malformed provider responses.
    await bindings.DB.prepare(
      "update wechat_channel_account set status = 'failed', last_error_code = 'missing_response', updated_at = ? where id = ?",
    )
      .bind(nowMsForTest(), account.id)
      .run();

    let nowMs = nowMsForTest();
    const result = await runWeChatPollingOwnerMaintenance(bindings, new Date(nowMsForTest()), {
      clientFactory: () => ({
        getUpdates: async ({ cursor }) => {
          expect(cursor).toBe("");
          return JSON.stringify({
            errcode: 0,
            errmsg: "",
            get_updates_buf: "cursor-after-recovery",
            longpolling_timeout_ms: 35000,
            msgs: [],
            ret: 0,
          });
        },
      }),
      executionContext: createTestExecutionContext(),
      nowMs: () => {
        nowMs += 100;
        return nowMs;
      },
    });

    expect(result).toEqual({
      failed: 0,
      polled: 1,
      skipped: 0,
      total: 1,
    });

    const recoveredAccount = await bindings.DB.prepare(
      "select cursor, status from wechat_channel_account where id = ?",
    )
      .bind(account.id)
      .first<{ cursor: string; status: string }>();
    expect(recoveredAccount).toEqual({
      cursor: "cursor-after-recovery",
      status: "running",
    });
  });

  test("scheduled WeChat polling owner rejects overlapping poll attempts for the same account", async () => {
    const bindings = await createWeChatTestBindings();
    const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot(),
    });
    const nowMs = nowMsForTest();
    let resolveStarted: (() => void) | null = null;
    let resolveUpdates: ((body: string) => void) | null = null;
    const getUpdatesStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const getUpdatesBody = new Promise<string>((resolve) => {
      resolveUpdates = resolve;
    });

    const firstPoll = pollWeChatChannelAccountOnce(bindings, {
      accountId: account.id,
      clientFactory: () => ({
        getUpdates: () => {
          resolveStarted?.();
          return getUpdatesBody;
        },
      }),
      executionContext: createTestExecutionContext(),
      nowMs: () => nowMs,
    });

    await getUpdatesStarted;

    const leasedRuntimeState = await bindings.DB.prepare(
      "select lease_owner_id, status from channel_runtime_state where provider = 'wechat' and binding_id = ?",
    )
      .bind(account.id)
      .first<{ lease_owner_id: string | null; status: string }>();
    expect(leasedRuntimeState?.lease_owner_id).toBeString();
    expect(leasedRuntimeState?.status).toBe("starting");

    await expect(
      pollWeChatChannelAccountOnce(bindings, {
        accountId: account.id,
        clientFactory: () => {
          throw new Error("Second poll must not create a WeChat polling client.");
        },
        executionContext: createTestExecutionContext(),
        nowMs: () => nowMs,
      }),
    ).resolves.toEqual({ code: "lease_unavailable" });

    resolveUpdates?.(
      JSON.stringify({
        get_updates_buf: "cursor-next",
        msgs: [],
        ret: 0,
      }),
    );

    await expect(firstPoll).resolves.toMatchObject({
      code: "polled",
      pollResult: {
        nextCursor: "cursor-next",
        status: "running",
      },
    });

    const completedRuntimeState = await bindings.DB.prepare(
      "select lease_owner_id, status from channel_runtime_state where provider = 'wechat' and binding_id = ?",
    )
      .bind(account.id)
      .first<{ lease_owner_id: string | null; status: string }>();
    expect(completedRuntimeState).toEqual({
      lease_owner_id: null,
      status: "running",
    });
  });
});
