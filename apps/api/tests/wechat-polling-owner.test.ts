import { describe, expect, test } from "bun:test";

import { summarizeChannelConnectionOwnerHealth } from "../src/modules/channels/application/channel-connection-health";
import type { WeChatIlinkWorkTrigger } from "../src/modules/channels/wechat/wechat-events";
import {
  WeChatIlinkApiError,
  WeChatIlinkClient,
  WeChatIlinkHttpError,
} from "../src/modules/channels/wechat/wechat-ilink-client";
import { WeChatPollingRuntimeOwner } from "../src/modules/channels/wechat/wechat-polling-owner";
import {
  MemoryWeChatPollingOwnerStore,
  createWeChatDmMessage,
} from "./wechat-channel-connection-fixtures";

describe("WeChat polling owner", () => {
  test("summarizes a leased long-poll runtime owner without provider-specific fields", () => {
    const snapshot = {
      key: {
        accountId: "account-1",
        bindingId: "binding-1",
        provider: "wechat",
      },
      lastErrorCode: null,
      lastHeartbeatAtMs: 1000,
      lastInboundAtMs: 1200,
      lastPollAtMs: 1300,
      leaseExpiresAtMs: 10_000,
      leaseOwnerId: "01J00000000000000000000001",
      status: "running" as const,
      statusChangedAtMs: 900,
    };

    expect(
      summarizeChannelConnectionOwnerHealth(snapshot, {
        nowMs: 2000,
        staleAfterMs: 5000,
      }),
    ).toEqual({
      reason: null,
      stale: false,
      status: "running",
    });
    expect(
      summarizeChannelConnectionOwnerHealth(snapshot, {
        nowMs: 10_001,
        staleAfterMs: 5000,
      }),
    ).toEqual({
      reason: "lease_expired",
      stale: true,
      status: "stale",
    });
  });

  test("calls iLink QR, poll, and sendmessage APIs without tokenless reply fallback", async () => {
    const requests: Array<{
      body: string | null;
      headers: Headers;
      method: string;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url =
        request instanceof Request ? request.url : request instanceof URL ? request.href : request;
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : null;

      requests.push({ body, headers, method, url });

      if (url.includes("get_bot_qrcode")) {
        return Response.json({
          qrcode: "qr-token",
          qrcode_img_content: "https://qr.example/scan",
        });
      }

      if (url.includes("get_qrcode_status")) {
        return Response.json({
          baseurl: "https://ilinkai.weixin.qq.com",
          bot_token: "bot-secret",
          ilink_bot_id: "bot-1",
          ilink_user_id: "account-1",
          status: "confirmed",
        });
      }

      if (url.includes("getupdates")) {
        return Response.json({
          get_updates_buf: "cursor-next",
          msgs: [],
          ret: 0,
        });
      }

      if (url.includes("sendmessage")) {
        return Response.json({ ret: 0 });
      }

      return Response.json({ errmsg: "unexpected", ret: 1 });
    };
    const client = new WeChatIlinkClient({
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "bot-secret",
      fetchImpl,
      randomUin: () => "uin-1",
    });
    expect(() => new WeChatIlinkClient({ baseUrl: "https://untrusted.example" })).toThrow();

    await expect(client.getBotQr()).resolves.toEqual({
      qrCodeImageContent: "https://qr.example/scan",
      qrToken: "qr-token",
    });
    await expect(client.getQrStatus({ qrToken: "qr-token" })).resolves.toMatchObject({
      bot_token: "bot-secret",
      ilink_bot_id: "bot-1",
      ilink_user_id: "account-1",
      status: "confirmed",
    });
    await expect(client.getUpdates({ cursor: "cursor-1", timeoutMs: 1000 })).resolves.toContain(
      "cursor-next",
    );
    await client.sendText({
      clientId: "client-1",
      contextToken: "ctx-secret",
      text: "reply text",
      toUserId: "peer-1",
    });
    await expect(
      client.sendText({
        clientId: "client-2",
        contextToken: " ",
        text: "reply text",
        toUserId: "peer-1",
      }),
    ).rejects.toThrow();

    const sendRequest = requests.find((request) => request.url.includes("sendmessage"));
    expect(sendRequest?.method).toBe("POST");
    expect(sendRequest?.headers.get("Authorization")).toBe("Bearer bot-secret");
    expect(sendRequest?.headers.get("X-WECHAT-UIN")).toBe("uin-1");
    expect(sendRequest?.body).toBeString();
    expect(JSON.parse(sendRequest?.body ?? "{}")).toMatchObject({
      msg: {
        client_id: "client-1",
        context_token: "ctx-secret",
        item_list: [{ text_item: { text: "reply text" }, type: 1 }],
        message_type: 2,
        to_user_id: "peer-1",
      },
    });
    expect(JSON.stringify(JSON.parse(sendRequest?.body ?? "{}"))).not.toContain("client-2");
  });

  test("polling owner persists context tokens and dispatches normalized DM triggers", async () => {
    const store = new MemoryWeChatPollingOwnerStore();
    const triggers: WeChatIlinkWorkTrigger[] = [];
    let nowMs = 1000;
    const owner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async ({ cursor, timeoutMs }) => {
          expect(cursor).toBe("");
          expect(timeoutMs).toBeNumber();
          return JSON.stringify({
            get_updates_buf: "cursor-next",
            msgs: [
              createWeChatDmMessage({ messageId: 123 }),
              {
                ...createWeChatDmMessage({ messageId: 124 }),
                room_id: "room-1",
              },
            ],
            ret: 0,
          });
        },
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

    await expect(owner.pollOnce()).resolves.toEqual({
      droppedMessageCount: 1,
      nextCursor: "cursor-next",
      processedMessageCount: 1,
      runtimeSummary: {
        nextCursor: "cursor-next",
        reason: null,
        status: "ok",
      },
      status: "running",
    });

    expect(store.cursor).toBe("cursor-next");
    expect(store.contextTokens).toEqual([
      expect.objectContaining({
        accountId: "account-1",
        bindingId: "binding-1",
        contextTokenKey: expect.any(String),
        contextTokenValue: "ctx-secret",
        peerId: "peer-1",
        toUserId: "peer-1",
      }),
    ]);
    expect(triggers).toHaveLength(1);
    expect(store.runtimeStates.at(-1)).toMatchObject({
      accountId: "account-1",
      bindingId: "binding-1",
      runtimeState: {
        lastProcessedMessageId: "123",
        nextCursor: "cursor-next",
        pollTimeoutMs: expect.any(Number),
      },
      snapshot: {
        key: {
          accountId: "account-1",
          bindingId: "binding-1",
          provider: "wechat",
        },
        lastErrorCode: null,
        status: "running",
      },
    });
    expect(store.runtimeStates.at(-1)?.runtimeStateJson).not.toContain("ctx-secret");
  });

  test("polling owner maps session expiry to relogin-required without advancing cursor", async () => {
    const store = new MemoryWeChatPollingOwnerStore();
    store.cursor = "cursor-old";
    const owner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async () =>
          JSON.stringify({
            errcode: -14,
            errmsg: "session expired",
            get_updates_buf: "cursor-new",
            msgs: [createWeChatDmMessage({ messageId: 123 })],
            ret: 0,
          }),
      },
      onTrigger: async () => {
        throw new Error("should not dispatch when relogin is required");
      },
      store,
    });

    await expect(owner.pollOnce()).resolves.toMatchObject({
      nextCursor: null,
      processedMessageCount: 0,
      runtimeSummary: {
        reason: "session_expired",
        status: "relogin_required",
      },
      status: "relogin_required",
    });
    expect(store.cursor).toBe("cursor-old");
    expect(store.contextTokens).toHaveLength(0);
    expect(store.runtimeStates.at(-1)?.snapshot).toMatchObject({
      lastErrorCode: "session_expired",
      status: "relogin_required",
    });
  });

  test("polling owner treats malformed message payloads as failed without advancing cursor", async () => {
    const store = new MemoryWeChatPollingOwnerStore();
    store.cursor = "cursor-old";
    const owner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async () =>
          JSON.stringify({
            get_updates_buf: "cursor-new",
            msgs: [
              {
                context_token: "ctx-secret",
                from_user_id: "peer-1",
                item_list: [{ text_item: { text: "hello" }, type: 1 }],
                message_id: 123,
                message_type: 1,
                to_user_id: "bot-1",
              },
            ],
            ret: 0,
          }),
      },
      onTrigger: async () => {
        throw new Error("should not dispatch malformed provider payloads");
      },
      store,
    });

    await expect(owner.pollOnce()).resolves.toMatchObject({
      nextCursor: "cursor-old",
      processedMessageCount: 0,
      status: "failed",
    });
    expect(store.cursor).toBe("cursor-old");
    expect(store.contextTokens).toHaveLength(0);
    expect(store.runtimeStates.at(-1)?.snapshot).toMatchObject({
      lastErrorCode: "invalid_messages",
      status: "failed",
    });
  });

  test("polling owner classifies credential and transient poll failures separately", async () => {
    const credentialStore = new MemoryWeChatPollingOwnerStore();
    credentialStore.cursor = "cursor-old";
    const credentialOwner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async () => {
          throw new WeChatIlinkApiError({
            code: "missing_bot_token",
            endpoint: "ilink/bot/getupdates",
            message: "missing token",
          });
        },
      },
      onTrigger: async () => {
        throw new Error("should not dispatch without credentials");
      },
      store: credentialStore,
    });

    await expect(credentialOwner.pollOnce()).resolves.toMatchObject({
      nextCursor: null,
      status: "relogin_required",
    });
    expect(credentialStore.cursor).toBe("cursor-old");
    expect(credentialStore.runtimeStates.at(-1)?.snapshot).toMatchObject({
      lastErrorCode: "missing_bot_token",
      status: "relogin_required",
    });

    const transientStore = new MemoryWeChatPollingOwnerStore();
    transientStore.cursor = "cursor-old";
    const transientOwner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async () => {
          throw new WeChatIlinkHttpError({
            bodyPreview: "temporary provider failure",
            endpoint: "ilink/bot/getupdates",
            status: 503,
          });
        },
      },
      onTrigger: async () => {
        throw new Error("should not dispatch during transient poll failures");
      },
      store: transientStore,
    });

    await expect(transientOwner.pollOnce()).resolves.toMatchObject({
      nextCursor: "cursor-old",
      status: "reconnecting",
    });
    expect(transientStore.cursor).toBe("cursor-old");
    expect(transientStore.runtimeStates.at(-1)?.snapshot).toMatchObject({
      lastErrorCode: "http_503",
      status: "reconnecting",
    });
  });

  test("polling owner does not advance cursor when trigger dispatch fails", async () => {
    const store = new MemoryWeChatPollingOwnerStore();
    const owner = new WeChatPollingRuntimeOwner({
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
      client: {
        getUpdates: async () =>
          JSON.stringify({
            get_updates_buf: "cursor-next",
            msgs: [createWeChatDmMessage({ messageId: 123 })],
            ret: 0,
          }),
      },
      onTrigger: async () => {
        throw new Error("dispatch failed");
      },
      store,
    });

    await expect(owner.pollOnce()).rejects.toThrow();
    expect(store.cursor).toBeNull();
    expect(store.contextTokens).toHaveLength(1);
    expect(store.runtimeStates.at(-1)?.snapshot).toMatchObject({
      lastErrorCode: "trigger_dispatch_failed",
      status: "failed",
    });
  });
});
