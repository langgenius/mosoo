import { describe, expect, test } from "bun:test";

import type { ChannelSessionCommandClient } from "../src/modules/channels/application/channel-session.types";
import { processDiscordWorkTrigger } from "../src/modules/channels/discord/discord-first-party-adapter";
import {
  DiscordWebApiClient,
  DiscordWebApiError,
} from "../src/modules/channels/discord/discord-web-api";
import { readFetchUrl } from "./helpers/fetch-request-url";

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected mocked Discord request body to be a JSON string.");
  }

  return JSON.parse(init.body);
}

describe("Discord channel adapter", () => {
  test("sends Discord messages and edits through the channel message API", async () => {
    const originalFetch = globalThis.fetch;
    const requests: { body: unknown; method: string; url: string }[] = [];
    globalThis.fetch = async (url, init) => {
      requests.push({
        body: readJsonRequestBody(init),
        method: init?.method ?? "GET",
        url: readFetchUrl(url),
      });
      return Response.json({ id: `message-${requests.length}` });
    };

    try {
      const client = new DiscordWebApiClient("discord-token");
      await expect(
        client.sendMessage({
          channelId: "channel-1",
          text: "Agent is working...",
        }),
      ).resolves.toEqual({
        channelId: "channel-1",
        messageId: "message-1",
      });
      await client.editMessage({
        channelId: "channel-1",
        messageId: "message-1",
        text: "Done",
      });

      expect(requests).toEqual([
        {
          body: { allowed_mentions: { parse: [] }, content: "Agent is working..." },
          method: "POST",
          url: "https://discord.com/api/v10/channels/channel-1/messages",
        },
        {
          body: { allowed_mentions: { parse: [] }, content: "Done" },
          method: "PATCH",
          url: "https://discord.com/api/v10/channels/channel-1/messages/message-1",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps Discord API failures to typed errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ code: 50001, message: "Missing Access" }, { status: 403 });

    try {
      await expect(
        new DiscordWebApiClient("discord-token").sendMessage({
          channelId: "channel-1",
          text: "hello",
        }),
      ).rejects.toEqual(new DiscordWebApiError("sendMessage", "Missing Access"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not mark Discord bindings errored for channel-scoped Missing Access failures", async () => {
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    const errorCodes: string[] = [];
    globalThis.fetch = async () =>
      Response.json({ code: 50001, message: "Missing Access" }, { status: 403 });
    globalThis.reportError = () => {};
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        errorCodes.push(errorCode);
      },
      async retrieveSessionReply() {
        throw new Error("Discord gateway relay path must not poll final replies.");
      },
    };

    try {
      await processDiscordWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          botToken: "discord-token",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Failed Discord working reply must not schedule final delivery.");
          },
        },
        sessionClient,
        trigger: {
          authorDisplayName: "Ada",
          authorId: "user-1",
          channelId: "channel-1",
          channelType: null,
          eventId: "discord:message:message-1",
          externalActorId: "discord:user:user-1",
          externalMessageId: "channel-1:message-1",
          externalThreadId: "guild:guild-1:channel:channel-1",
          guildId: "guild-1",
          messageId: "message-1",
          text: "review this",
        },
      });

      expect(errorCodes).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }
  });

  test("writes Discord working and final replies through durable final delivery", async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: unknown[] = [];
    const finalDeliveryJobs: unknown[] = [];
    globalThis.fetch = async (_url, init) => {
      requestBodies.push(readJsonRequestBody(init));
      return Response.json({ id: `message-${requestBodies.length}` });
    };
    const sessionClient: ChannelSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError() {},
      async retrieveSessionReply() {
        throw new Error("Discord gateway relay path must not poll final replies.");
      },
    };

    try {
      await processDiscordWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          botToken: "discord-token",
          sessionLinkBaseUrl: "https://mosoo.ai",
        },
        finalDeliveryScheduler: {
          async enqueue(job) {
            finalDeliveryJobs.push(job);
          },
        },
        sessionClient,
        trigger: {
          authorDisplayName: "Ada",
          authorId: "user-1",
          channelId: "channel-1",
          channelType: null,
          eventId: "discord:message:message-1",
          externalActorId: "discord:user:user-1",
          externalMessageId: "channel-1:message-1",
          externalThreadId: "guild:guild-1:channel:channel-1",
          guildId: "guild-1",
          messageId: "message-1",
          text: "review this",
        },
      });

      expect(requestBodies).toEqual([
        {
          allowed_mentions: { parse: [] },
          content:
            "mosoo session created: https://mosoo.ai/agent/01J00000000000000000000009?tab=consume&sessionId=session-1. Agent is working...",
        },
      ]);
      expect(finalDeliveryJobs).toEqual([
        {
          bindingId: "binding-1",
          externalEventId: "discord:message:message-1",
          payload: {
            channelId: "channel-1",
            provider: "discord",
            workingMessage: {
              channelId: "channel-1",
              messageId: "message-1",
            },
          },
          provider: "discord",
          runId: "run-1",
          sessionId: "session-1",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
