import { describe, expect, test } from "bun:test";

import {
  createWeChatProviderMetadata,
  normalizeWeChatIlinkWorkTrigger,
  summarizeWeChatPollRuntime,
} from "../src/modules/channels/wechat/wechat-events";
import { applyWeChatQrStatusResponse } from "../src/modules/channels/wechat/wechat-runtime";
import { parseSuccessfulWeChatPoll } from "./wechat-channel-connection-fixtures";

describe("WeChat channel connection scaffold", () => {
  test("normalizes finished DM text messages and separates context-token routing state", () => {
    const envelope = parseSuccessfulWeChatPoll({
      get_updates_buf: "cursor-next",
      msgs: [
        {
          client_id: "client-1",
          context_token: "ctx-secret",
          create_time_ms: 1779646500000,
          from_user_id: "peer-1",
          item_list: [{ text_item: { text: "hello Mosoo" }, type: 1 }],
          message_id: 123,
          message_state: 2,
          message_type: 1,
          to_user_id: "bot-1",
        },
      ],
      ret: 0,
    });

    expect(summarizeWeChatPollRuntime(envelope)).toEqual({
      nextCursor: "cursor-next",
      reason: null,
      status: "ok",
    });

    const trigger = normalizeWeChatIlinkWorkTrigger(envelope.messages[0], {
      accountId: "account-1",
      bindingId: "binding-1",
      botId: "bot-1",
    });

    expect(trigger).toEqual({
      eventId: "wechat:message:123",
      externalActorId: "wechat:user:peer-1",
      externalMessageId: "peer-1:123",
      externalThreadId: "wechat:dm:peer-1",
      messageId: "123",
      peerId: "peer-1",
      replyRoute: {
        contextTokenKey: expect.any(String),
        contextTokenValue: "ctx-secret",
        toUserId: "peer-1",
      },
      text: "hello Mosoo",
    });

    if (!trigger) {
      throw new Error("Expected WeChat trigger.");
    }

    expect(createWeChatProviderMetadata(trigger)).toEqual({
      chatType: "dm",
      peerId: "peer-1",
    });
    expect(JSON.stringify(createWeChatProviderMetadata(trigger))).not.toContain("ctx-secret");
  });

  test("rejects bot, unfinished, ambiguous, and group-shaped messages", () => {
    const baseMessage = parseSuccessfulWeChatPoll({
      get_updates_buf: "cursor-next",
      msgs: [
        {
          context_token: "ctx-secret",
          from_user_id: "peer-1",
          item_list: [{ text_item: { text: "hello" }, type: 1 }],
          message_id: 123,
          message_state: 2,
          message_type: 1,
          to_user_id: "bot-1",
        },
      ],
      ret: 0,
    }).messages[0];

    expect(
      normalizeWeChatIlinkWorkTrigger(
        {
          ...baseMessage,
          messageType: 2,
        },
        { accountId: "account-1", bindingId: "binding-1", botId: "bot-1" },
      ),
    ).toBeNull();
    expect(
      normalizeWeChatIlinkWorkTrigger(
        {
          ...baseMessage,
          messageState: 1,
        },
        { accountId: "account-1", bindingId: "binding-1", botId: "bot-1" },
      ),
    ).toBeNull();
    expect(
      normalizeWeChatIlinkWorkTrigger(
        {
          ...baseMessage,
          toUserId: "other-account",
        },
        { accountId: "account-1", bindingId: "binding-1", botId: "bot-1" },
      ),
    ).toBeNull();
    expect(
      normalizeWeChatIlinkWorkTrigger(
        {
          ...baseMessage,
          roomId: "room-1",
        },
        { accountId: "account-1", bindingId: "binding-1", botId: "bot-1" },
      ),
    ).toBeNull();
  });

  test("maps iLink session expiry to relogin-required runtime state", () => {
    const envelope = parseSuccessfulWeChatPoll({
      errcode: -14,
      errmsg: "session expired",
      get_updates_buf: "stale-cursor",
      msgs: [],
      ret: 0,
    });

    expect(summarizeWeChatPollRuntime(envelope)).toEqual({
      nextCursor: null,
      reason: "session_expired",
      status: "relogin_required",
    });

    expect(
      summarizeWeChatPollRuntime(
        parseSuccessfulWeChatPoll({
          errcode: -14,
          errmsg: "session expired",
          get_updates_buf: "stale-cursor",
          ret: 0,
        }),
      ),
    ).toMatchObject({
      reason: "session_expired",
      status: "relogin_required",
    });
  });

  test("models QR pairing as an account-runtime state machine", () => {
    const initial = {
      accountId: null,
      baseUrl: null,
      botToken: null,
      expiresAtMs: 1779646800000,
      ilinkBotId: null,
      ilinkUserId: null,
      lastErrorCode: null,
      qrCodeImageSrc: "base64-qr",
      qrToken: "qr-token",
      status: "qr_pending" as const,
    };

    expect(applyWeChatQrStatusResponse(initial, { status: "scaned" })).toMatchObject({
      status: "scanned",
    });
    expect(applyWeChatQrStatusResponse(initial, { status: "expired" })).toMatchObject({
      lastErrorCode: "qr_expired",
      status: "expired",
    });
    expect(applyWeChatQrStatusResponse(initial, { status: "confirmed" })).toMatchObject({
      lastErrorCode: "confirmed_missing_credentials",
      status: "failed",
    });
    expect(
      applyWeChatQrStatusResponse(initial, {
        baseurl: "https://ilinkai.weixin.qq.com/",
        bot_token: "bot-secret",
        ilink_bot_id: "bot-1",
        ilink_user_id: "account-1",
        status: "confirmed",
      }),
    ).toMatchObject({
      accountId: "account-1",
      baseUrl: "https://ilinkai.weixin.qq.com",
      botToken: "bot-secret",
      ilinkBotId: "bot-1",
      ilinkUserId: "account-1",
      status: "confirmed",
    });
    expect(
      applyWeChatQrStatusResponse(initial, {
        baseurl: "https://untrusted.example",
        bot_token: "bot-secret",
        ilink_bot_id: "bot-1",
        ilink_user_id: "account-1",
        status: "confirmed",
      }),
    ).toMatchObject({
      lastErrorCode: "confirmed_untrusted_base_url",
      status: "failed",
    });
  });
});
