import { describe, expect, test } from "bun:test";

import type { WeChatIlinkWorkTrigger } from "../src/modules/channels/wechat/wechat-events";
import { WeChatPollingRuntimeOwner } from "../src/modules/channels/wechat/wechat-polling-owner";
import {
  sendWeChatStoredContextReply,
  WeChatReplyError,
} from "../src/modules/channels/wechat/wechat-reply.service";
import { createWeChatContextTokenStoreKey } from "../src/modules/channels/wechat/wechat-runtime";
import {
  createWeChatPollingOwnerDatabaseStore,
  persistConfirmedWeChatQrPairing,
  readWeChatChannelAccountWithCredentials,
  readWeChatContextTokenForPeer,
} from "../src/modules/channels/wechat/wechat-runtime-store";
import { nowMsForTest, PUBLIC_API_TEST_IDS } from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  createConfirmedWeChatQrSnapshot,
  createWeChatDmMessage,
  createWeChatTestBindings,
} from "./wechat-channel-connection-fixtures";

describe("WeChat channel runtime persistence", () => {
  test("persists confirmed QR credentials as an encrypted channel binding account runtime", async () => {
    const bindings = await createWeChatTestBindings();
    const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot({
        baseUrl: "https://ilinkai.weixin.qq.com/",
      }),
    });

    expect(account).toMatchObject({
      agentId: "01J00000000000000000000009",
      baseUrl: "https://ilinkai.weixin.qq.com",
      cursor: null,
      externalAccountId: "account-1",
      externalBotId: "bot-1",
      ownerAccountId: "01J00000000000000000000001",
      status: "idle",
    });

    const withCredentials = await readWeChatChannelAccountWithCredentials(bindings, {
      accountId: account.id,
    });
    expect(withCredentials?.credentials).toEqual({
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "bot-secret",
      ilinkBotId: "bot-1",
      ilinkUserId: "account-1",
    });

    expect(JSON.stringify(withCredentials)).not.toContain("wrapped_dek");
  });

  test("rejects untrusted persisted QR base URLs before storing credentials", async () => {
    const bindings = await createWeChatTestBindings();

    await expect(
      persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        snapshot: createConfirmedWeChatQrSnapshot({
          baseUrl: "https://untrusted.example",
        }),
      }),
    ).rejects.toThrow();

    expect(
      await readWeChatChannelAccountWithCredentials(bindings, {
        accountId: "01J00000000000000000000009",
      }),
    ).toBeNull();
  });

  test("clears stale context-token secrets when QR pairing is rebound", async () => {
    const bindings = await createWeChatTestBindings();
    const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot({ botToken: "bot-secret-1" }),
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
      contextTokenValue: "ctx-secret-1",
      peerId: "peer-1",
      toUserId: "peer-1",
      updatedAtMs: 1779646500000,
    });

    await expect(
      readWeChatContextTokenForPeer(bindings, {
        accountId: account.id,
        peerId: "peer-1",
      }),
    ).resolves.toMatchObject({
      contextToken: "ctx-secret-1",
    });

    const rebound = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot({
        accountId: "account-2",
        botToken: "bot-secret-2",
        ilinkBotId: "bot-2",
        ilinkUserId: "account-2",
      }),
    });

    expect(rebound).toMatchObject({
      externalAccountId: "account-2",
      externalBotId: "bot-2",
      id: account.id,
      status: "idle",
    });

    await expect(
      readWeChatContextTokenForPeer(bindings, {
        accountId: account.id,
        peerId: "peer-1",
      }),
    ).resolves.toBeNull();
  });

  test("database polling store persists cursor/runtime/context token and stored-token replies", async () => {
    const bindings = await createWeChatTestBindings();
    const account = await persistConfirmedWeChatQrPairing(bindings, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
      snapshot: createConfirmedWeChatQrSnapshot(),
    });
    const store = createWeChatPollingOwnerDatabaseStore(bindings);
    const triggers: WeChatIlinkWorkTrigger[] = [];
    let nowMs = 2000;
    const owner = new WeChatPollingRuntimeOwner({
      accountId: account.externalAccountId,
      bindingId: account.id,
      botId: account.externalBotId,
      client: {
        getUpdates: async () =>
          JSON.stringify({
            get_updates_buf: "cursor-next",
            msgs: [createWeChatDmMessage({ contextToken: "ctx-secret", messageId: 123 })],
            ret: 0,
          }),
      },
      nowMs: () => {
        nowMs += 100;
        return nowMs;
      },
      onTrigger: async (trigger) => {
        triggers.push(trigger);
      },
      store,
    });

    await expect(owner.pollOnce()).resolves.toMatchObject({
      droppedMessageCount: 0,
      nextCursor: "cursor-next",
      processedMessageCount: 1,
      status: "running",
    });
    expect(triggers).toHaveLength(1);

    const runtimeRow = await bindings.DB.prepare(
      "select cursor, runtime_state_json, status from wechat_channel_account where id = ?",
    )
      .bind(account.id)
      .first<{ cursor: string; runtime_state_json: string; status: string }>();
    expect(runtimeRow).toMatchObject({
      cursor: "cursor-next",
      status: "running",
    });
    expect(runtimeRow?.runtime_state_json).toContain("cursor-next");
    expect(runtimeRow?.runtime_state_json).not.toContain("ctx-secret");

    const sendRequests: Array<{ body: string | null; headers: Headers; url: string }> = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url =
        request instanceof Request ? request.url : request instanceof URL ? request.href : request;
      sendRequests.push({
        body: typeof init?.body === "string" ? init.body : null,
        headers: new Headers(init?.headers),
        url,
      });
      return Response.json({ ret: 0 });
    };

    await sendWeChatStoredContextReply(bindings, {
      accountId: account.id,
      clientId: "reply-client-1",
      fetchImpl,
      peerId: "peer-1",
      text: "reply from mosoo",
    });

    expect(sendRequests).toHaveLength(1);
    expect(sendRequests[0]?.url).toBe("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage");
    expect(sendRequests[0]?.headers.get("Authorization")).toBe("Bearer bot-secret");
    expect(JSON.parse(sendRequests[0]?.body ?? "{}")).toMatchObject({
      msg: {
        client_id: "reply-client-1",
        context_token: "ctx-secret",
        item_list: [{ text_item: { text: "reply from mosoo" }, type: 1 }],
        to_user_id: "peer-1",
      },
    });

    await bindings.DB.prepare("update wechat_channel_account set status = 'stopped' where id = ?")
      .bind(account.id)
      .run();
    try {
      await sendWeChatStoredContextReply(bindings, {
        accountId: account.id,
        clientId: "reply-client-2",
        fetchImpl,
        peerId: "peer-1",
        text: "reply after stop",
      });
      throw new Error("Expected stopped WeChat account reply to fail.");
    } catch (error) {
      if (!(error instanceof WeChatReplyError)) {
        throw error;
      }

      expect(error.code).toBe("account_not_running");
    }
    expect(sendRequests).toHaveLength(1);
  });
});
