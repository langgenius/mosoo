import { describe, expect, test } from "bun:test";

import type { ChannelSessionCommandClient } from "../src/modules/channels/application/channel-session.service";
import {
  normalizeTelegramWorkTrigger,
  parseTelegramUpdateEnvelope,
} from "../src/modules/channels/telegram/telegram-events";
import { processTelegramWorkTrigger } from "../src/modules/channels/telegram/telegram-first-party-adapter";
import { verifyTelegramWebhookSecret } from "../src/modules/channels/telegram/telegram-signing";
import {
  TelegramWebApiClient,
  TelegramWebApiError,
} from "../src/modules/channels/telegram/telegram-web-api";
import { readFetchUrl } from "./helpers/fetch-request-url";

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected mocked Telegram request body to be a JSON string.");
  }

  return JSON.parse(init.body);
}

describe("Telegram channel adapter", () => {
  test("verifies Telegram webhook secret token in constant-shape result", () => {
    expect(
      verifyTelegramWebhookSecret({
        headers: new Headers({
          "x-telegram-bot-api-secret-token": "expected-secret",
        }),
        webhookSecret: "expected-secret",
      }),
    ).toEqual({ ok: true });

    expect(
      verifyTelegramWebhookSecret({
        headers: new Headers({
          "x-telegram-bot-api-secret-token": "wrong-secret",
        }),
        webhookSecret: "expected-secret",
      }),
    ).toMatchObject({ code: "secret_mismatch", ok: false, status: 401 });
  });

  test("normalizes message updates into chat and topic thread keys", () => {
    const parsed = parseTelegramUpdateEnvelope(
      JSON.stringify({
        message: {
          chat: { id: -100123, title: "Launch", type: "supergroup" },
          from: { first_name: "Ada", id: 42, is_bot: false, username: "ada" },
          message_id: 77,
          message_thread_id: 12,
          text: "/ask review the launch plan",
        },
        update_id: 9001,
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected Telegram update parse success.");
    }

    expect(normalizeTelegramWorkTrigger(parsed.envelope)).toEqual({
      chatId: "-100123",
      chatTitle: "Launch",
      chatType: "supergroup",
      eventId: "telegram:update:9001",
      externalActorId: "telegram:user:42",
      externalMessageId: "-100123:77",
      externalThreadId: "-100123:12",
      messageId: 77,
      messageThreadId: 12,
      text: "review the launch plan",
      userDisplayName: "Ada",
      userId: "42",
      username: "ada",
    });
  });

  test("sends Telegram replies with optional message_thread_id", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: unknown[] = [];
    globalThis.fetch = async (url, init) => {
      requestBodies.push(readJsonRequestBody(init));
      if (readFetchUrl(url) === "https://api.telegram.org/bottest-token/sendMessage") {
        return Response.json({
          ok: true,
          result: { chat: { id: -100123 }, message_id: 88 },
        });
      }

      return originalFetch(url, init);
    };

    try {
      await expect(
        new TelegramWebApiClient("test-token").sendMessage({
          chatId: "-100123",
          messageThreadId: 12,
          text: "Agent is working...",
        }),
      ).resolves.toEqual({
        chatId: "-100123",
        messageId: 88,
      });
      expect(requestBodies).toEqual([
        {
          chat_id: "-100123",
          message_thread_id: 12,
          text: "Agent is working...",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps Telegram API failures to typed errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ description: "Forbidden: bot was blocked", ok: false });

    try {
      await expect(
        new TelegramWebApiClient("test-token").sendMessage({
          chatId: "42",
          messageThreadId: null,
          text: "hello",
        }),
      ).rejects.toEqual(new TelegramWebApiError("sendMessage", "Forbidden: bot was blocked"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("writes Telegram working and final replies through sendMessage", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: unknown[] = [];
    const finalDeliveryJobs: unknown[] = [];
    let capturedExternalWorkspaceId: unknown;
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(readJsonRequestBody(init));
      return Response.json({
        ok: true,
        result: { chat: { id: 42 }, message_id: requestBodies.length },
      });
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession(command) {
        capturedExternalWorkspaceId = command.trigger.externalWorkspaceId;
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError() {},
      async retrieveSessionReply() {
        throw new Error("Telegram webhook path must not poll final replies.");
      },
    };

    try {
      await processTelegramWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          botToken: "test-token",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue(job) {
            finalDeliveryJobs.push(job);
          },
        },
        sessionClient,
        trigger: {
          chatId: "42",
          chatTitle: null,
          chatType: "private",
          eventId: "telegram:update:1",
          externalActorId: "telegram:user:42",
          externalMessageId: "42:77",
          externalThreadId: "42:main",
          messageId: 77,
          messageThreadId: null,
          text: "review this",
          userDisplayName: "Ada",
          userId: "42",
          username: "ada",
        },
      });

      expect(capturedExternalWorkspaceId).toBe("42");
      expect(requestBodies).toEqual([
        {
          chat_id: "42",
          text: "mosoo session created: https://mosoo.ai/agent/01J00000000000000000000009?tab=consume&sessionId=session-1. Agent is working...",
        },
      ]);
      expect(finalDeliveryJobs).toEqual([
        {
          bindingId: "binding-1",
          externalEventId: "telegram:update:1",
          payload: {
            chatId: "42",
            messageThreadId: null,
            provider: "telegram",
          },
          provider: "telegram",
          runId: "run-1",
          sessionId: "session-1",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not mark Telegram bindings errored for chat-scoped send failures", async () => {
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    const markedErrors: string[] = [];
    globalThis.reportError = () => {};
    globalThis.fetch = async () =>
      Response.json({
        description: "Forbidden: bot was blocked by the user",
        ok: false,
      });
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        markedErrors.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Telegram webhook path must not poll final replies.");
      },
    };

    try {
      await processTelegramWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          botToken: "test-token",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Final delivery should not be scheduled when the working reply fails.");
          },
        },
        sessionClient,
        trigger: {
          chatId: "42",
          chatTitle: null,
          chatType: "private",
          eventId: "telegram:update:blocked-chat",
          externalActorId: "telegram:user:42",
          externalMessageId: "42:77",
          externalThreadId: "42:main",
          messageId: 77,
          messageThreadId: null,
          text: "review this",
          userDisplayName: "Ada",
          userId: "42",
          username: "ada",
        },
      });

      expect(markedErrors).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }
  });

  test("marks Telegram bindings errored for token-scoped send failures", async () => {
    const originalFetch = globalThis.fetch;
    const markedErrors: string[] = [];
    globalThis.fetch = async () =>
      Response.json({
        description: "Unauthorized",
        ok: false,
      });
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        markedErrors.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Telegram webhook path must not poll final replies.");
      },
    };

    try {
      await processTelegramWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          botToken: "test-token",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Final delivery should not be scheduled when the working reply fails.");
          },
        },
        sessionClient,
        trigger: {
          chatId: "42",
          chatTitle: null,
          chatType: "private",
          eventId: "telegram:update:unauthorized",
          externalActorId: "telegram:user:42",
          externalMessageId: "42:77",
          externalThreadId: "42:main",
          messageId: 77,
          messageThreadId: null,
          text: "review this",
          userDisplayName: "Ada",
          userId: "42",
          username: "ada",
        },
      });

      expect(markedErrors).toEqual(["Unauthorized"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
