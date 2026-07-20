import { describe, expect, test } from "bun:test";

import type { ChannelSessionCommandClient } from "../src/modules/channels/application/channel-session.types";
import {
  normalizeLarkWorkTrigger,
  parseLarkEventsEnvelope,
} from "../src/modules/channels/lark/lark-events";
import { processLarkWorkTrigger } from "../src/modules/channels/lark/lark-first-party-adapter";
import { verifyLarkSignature } from "../src/modules/channels/lark/lark-signing";
import { LarkWebApiClient } from "../src/modules/channels/lark/lark-web-api";
import { readFetchUrl } from "./helpers/fetch-request-url";

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected mocked Lark request body to be a JSON string.");
  }

  return JSON.parse(init.body);
}

async function signLarkBody(input: {
  body: string;
  encryptKey: string;
  nonce: string;
  timestamp: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input.timestamp + input.nonce + input.encryptKey + input.body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

describe("Lark channel adapter", () => {
  test("verifies Lark signatures over the raw request body", async () => {
    const body = JSON.stringify({ challenge: "challenge-ok", type: "url_verification" });
    const timestamp = "1779646500";
    const nowMs = Number(timestamp) * 1000;
    const nonce = "nonce-1";
    const encryptKey = "encrypt-key";
    const signature = await signLarkBody({ body, encryptKey, nonce, timestamp });

    await expect(
      verifyLarkSignature({
        body,
        encryptKey,
        headers: new Headers({
          "x-lark-request-nonce": nonce,
          "x-lark-request-timestamp": timestamp,
          "x-lark-signature": signature,
        }),
        nowMs,
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyLarkSignature({
        body,
        encryptKey: "wrong-key",
        headers: new Headers({
          "x-lark-request-nonce": nonce,
          "x-lark-request-timestamp": timestamp,
          "x-lark-signature": signature,
        }),
        nowMs,
      }),
    ).resolves.toMatchObject({ code: "signature_mismatch", ok: false, status: 401 });
  });

  test("normalizes im.message.receive_v1 events with domain-specific metadata", () => {
    const body = JSON.stringify({
      event: {
        message: {
          chat_id: "oc_chat",
          chat_type: "group",
          content: JSON.stringify({ text: "@_user_1 review the launch plan" }),
          message_id: "om_message",
          mentions: [{ id: { open_id: "ou_bot" }, name: "mosoobot" }],
          root_id: "om_root",
        },
        sender: {
          sender_id: {
            open_id: "ou_alice",
            union_id: "on_union",
            user_id: "user_alice",
          },
          sender_type: "user",
        },
      },
      header: {
        event_id: "ev_lark_1",
        event_type: "im.message.receive_v1",
        tenant_key: "tenant_1",
        token: "verification-token",
      },
      schema: "2.0",
    });
    const parsed = parseLarkEventsEnvelope(body, {
      verificationToken: "verification-token",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.envelope.type !== "event_callback") {
      throw new Error("Expected Lark event_callback envelope.");
    }

    expect(normalizeLarkWorkTrigger(parsed.envelope)).toEqual({
      chatId: "oc_chat",
      chatType: "group",
      eventId: "lark:event:ev_lark_1",
      externalActorId: "lark:ou_alice",
      externalMessageId: "om_message",
      externalThreadId: "oc_chat:om_root",
      messageId: "om_message",
      parentId: null,
      rootId: "om_root",
      senderOpenId: "ou_alice",
      senderType: "user",
      senderUnionId: "on_union",
      senderUserId: "user_alice",
      tenantKey: "tenant_1",
      text: "review the launch plan",
    });
  });

  test("chooses the correct Open Platform origin for Lark and Feishu domains", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (url) => {
      urls.push(readFetchUrl(url));
      return Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      });
    };

    try {
      await new LarkWebApiClient({
        appId: "cli_a",
        appSecret: "secret",
        domain: "lark",
      }).getTenantAccessToken();
      await new LarkWebApiClient({
        appId: "cli_b",
        appSecret: "secret",
        domain: "feishu",
      }).getTenantAccessToken();

      expect(urls).toEqual([
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("writes Lark working and final replies through message reply API", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: unknown[] = [];
    const finalDeliveryJobs: unknown[] = [];
    let capturedConnectionMode: unknown;
    globalThis.fetch = async (url, init) => {
      const requestUrl = readFetchUrl(url);

      if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
        return Response.json({
          code: 0,
          tenant_access_token: "tenant-token",
        });
      }

      requestBodies.push(readJsonRequestBody(init));
      return Response.json({ code: 0, data: {} });
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession(command) {
        capturedConnectionMode = command.trigger.providerMetadata["connection_mode"];
        expect(command.trigger.externalWorkspaceId).toBe("tenant_1");
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError() {},
      async retrieveSessionReply() {
        throw new Error("Lark webhook path must not poll final replies.");
      },
    };

    try {
      await processLarkWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          appId: "cli_a",
          appSecret: "secret",
          bindingId: "binding-1",
          connectionMode: "webhook",
          domain: "feishu",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue(job) {
            finalDeliveryJobs.push(job);
          },
        },
        sessionClient,
        trigger: {
          chatId: "oc_chat",
          chatType: "group",
          eventId: "lark:event:ev_lark_1",
          externalActorId: "lark:ou_alice",
          externalMessageId: "om_message",
          externalThreadId: "oc_chat:om_root",
          messageId: "om_message",
          parentId: null,
          rootId: "om_root",
          senderOpenId: "ou_alice",
          senderType: "user",
          senderUnionId: "on_union",
          senderUserId: "user_alice",
          tenantKey: "tenant_1",
          text: "review this",
        },
      });

      expect(capturedConnectionMode).toBe("webhook");
      expect(requestBodies).toEqual([
        {
          content: JSON.stringify({
            text: "mosoo session created: https://mosoo.ai/agent/01J00000000000000000000009?tab=consume&sessionId=session-1. Agent is working...",
          }),
          msg_type: "text",
        },
      ]);
      expect(finalDeliveryJobs).toEqual([
        {
          bindingId: "binding-1",
          externalEventId: "lark:event:ev_lark_1",
          payload: {
            messageId: "om_message",
            provider: "lark",
          },
          provider: "lark",
          runId: "run-1",
          sessionId: "session-1",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not mark Lark binding error when message reply fails after token acquisition", async () => {
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    const markedBindingErrors: string[] = [];
    globalThis.reportError = () => {};
    globalThis.fetch = async (url) => {
      const requestUrl = readFetchUrl(url);

      if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
        return Response.json({
          code: 0,
          tenant_access_token: "tenant-token",
        });
      }

      return Response.json({ code: 999, msg: "message is not replyable" });
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        markedBindingErrors.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Lark webhook path must not poll final replies.");
      },
    };

    try {
      await processLarkWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          appId: "cli_a",
          appSecret: "secret",
          bindingId: "binding-1",
          connectionMode: "webhook",
          domain: "feishu",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Reply failure must stop final delivery enqueue.");
          },
        },
        sessionClient,
        trigger: {
          chatId: "oc_chat",
          chatType: "group",
          eventId: "lark:event:ev_lark_reply_failure",
          externalActorId: "lark:ou_alice",
          externalMessageId: "om_message",
          externalThreadId: "oc_chat:om_root",
          messageId: "om_message",
          parentId: null,
          rootId: "om_root",
          senderOpenId: "ou_alice",
          senderType: "user",
          senderUnionId: "on_union",
          senderUserId: "user_alice",
          tenantKey: "tenant_1",
          text: "review this",
        },
      });

      expect(markedBindingErrors).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }
  });

  test("marks Lark binding error when message reply fails with a permission error", async () => {
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    const markedBindingErrors: string[] = [];
    globalThis.reportError = () => {};
    globalThis.fetch = async (url) => {
      const requestUrl = readFetchUrl(url);

      if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
        return Response.json({
          code: 0,
          tenant_access_token: "tenant-token",
        });
      }

      return Response.json({ code: 230035, msg: "Send Message Permission deny." });
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        markedBindingErrors.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Lark webhook path must not poll final replies.");
      },
    };

    try {
      await processLarkWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          appId: "cli_a",
          appSecret: "secret",
          bindingId: "binding-1",
          connectionMode: "webhook",
          domain: "feishu",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Permission failure must stop final delivery enqueue.");
          },
        },
        sessionClient,
        trigger: {
          chatId: "oc_chat",
          chatType: "group",
          eventId: "lark:event:ev_lark_permission_failure",
          externalActorId: "lark:ou_alice",
          externalMessageId: "om_message",
          externalThreadId: "oc_chat:om_root",
          messageId: "om_message",
          parentId: null,
          rootId: "om_root",
          senderOpenId: "ou_alice",
          senderType: "user",
          senderUnionId: "on_union",
          senderUserId: "user_alice",
          tenantKey: "tenant_1",
          text: "review this",
        },
      });

      expect(markedBindingErrors).toEqual(["lark_230035"]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }
  });

  test("marks Lark binding error when tenant token acquisition fails", async () => {
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    const markedBindingErrors: string[] = [];
    globalThis.reportError = () => {};
    globalThis.fetch = async (url) => {
      const requestUrl = readFetchUrl(url);

      if (requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal") {
        return Response.json({ code: 99991663, msg: "invalid app_secret" });
      }

      throw new Error(`Unexpected Lark fetch: ${requestUrl}`);
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        markedBindingErrors.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Lark webhook path must not poll final replies.");
      },
    };

    try {
      await processLarkWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          appId: "cli_a",
          appSecret: "bad-secret",
          bindingId: "binding-1",
          connectionMode: "webhook",
          domain: "feishu",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Token failure must stop final delivery enqueue.");
          },
        },
        sessionClient,
        trigger: {
          chatId: "oc_chat",
          chatType: "group",
          eventId: "lark:event:ev_lark_token_failure",
          externalActorId: "lark:ou_alice",
          externalMessageId: "om_message",
          externalThreadId: "oc_chat:om_root",
          messageId: "om_message",
          parentId: null,
          rootId: "om_root",
          senderOpenId: "ou_alice",
          senderType: "user",
          senderUnionId: "on_union",
          senderUserId: "user_alice",
          tenantKey: "tenant_1",
          text: "review this",
        },
      });

      expect(markedBindingErrors).toEqual(["lark_99991663"]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }
  });
});
