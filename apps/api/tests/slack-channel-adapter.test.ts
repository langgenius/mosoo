import { describe, expect, test } from "bun:test";

import type { SlackWorkTrigger } from "../src/modules/channels/slack/slack-events";
import { processSlackWorkTrigger } from "../src/modules/channels/slack/slack-first-party-adapter";
import type { SlackSessionCommandClient } from "../src/modules/channels/slack/slack-first-party-adapter";
import { SlackWebApiClient, SlackWebApiError } from "../src/modules/channels/slack/slack-web-api";
import { readFetchUrl } from "./helpers/fetch-request-url";

function readJsonObjectBody(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error("Expected Slack request body to be a JSON object.");
}

describe("Slack channel adapter", () => {
  test("uses internal session commands and only calls Slack Web API", async () => {
    const fetchUrls: string[] = [];
    const fetchBodies: Record<string, unknown>[] = [];
    const finalDeliveryJobs: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      fetchUrls.push(readFetchUrl(url));
      if (typeof init?.body === "string") {
        fetchBodies.push(readJsonObjectBody(init.body));
      }
      return Response.json({ channel: "C123", ok: true, ts: "1700000000.000200" });
    };
    const trigger: SlackWorkTrigger = {
      botUserId: "U-BOT",
      channelId: "C123",
      enterpriseId: null,
      eventId: "Ev3",
      isEnterpriseInstall: false,
      messageTs: "1700000000.000100",
      requiresExistingSession: false,
      teamId: "T123",
      text: "ship it",
      threadTs: "1700000000.000100",
      triggerType: "app_mention",
      userId: "U-ALICE",
    };
    const sessionClient: SlackSessionCommandClient = {
      async createOrContinueSession(input) {
        expect(input.clientRequestId).toBe("slack:event:Ev3");
        expect(input.trigger.requiresExistingSession).toBe(false);
        expect(input.text).toContain("Slack thread: 1700000000.000100");
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError() {
        throw new Error("Binding error should not be marked for successful Slack delivery.");
      },
      async retrieveSessionReply(sessionId) {
        throw new Error(`Slack webhook path must not poll final replies for ${sessionId}.`);
      },
    };

    try {
      await processSlackWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          sessionLinkBaseUrl: "https://mosoo.ai",
          slackBotToken: "xoxb-token",
        },
        finalDeliveryScheduler: {
          async enqueue(job) {
            finalDeliveryJobs.push(job);
          },
        },
        sessionClient,
        trigger,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchUrls).toEqual(["https://slack.com/api/chat.postMessage"]);
    expect(fetchBodies[0]?.["text"]).toContain("Agent is working");
    expect(finalDeliveryJobs).toEqual([
      {
        bindingId: "binding-1",
        externalEventId: "slack:event:Ev3",
        payload: {
          channelId: "C123",
          provider: "slack",
          threadTs: "1700000000.000100",
          workingMessage: {
            channelId: "C123",
            ts: "1700000000.000200",
          },
        },
        provider: "slack",
        runId: "run-1",
        sessionId: "session-1",
      },
    ]);
  });

  test("does not write Slack messages for duplicate event ids", async () => {
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchUrls.push(readFetchUrl(url));
      return Response.json({ channel: "C123", ok: true, ts: "1700000000.000200" });
    };
    const sessionClient: SlackSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: true, runId: null, sessionId: "session-1" };
      },
      async markBindingError() {
        throw new Error("Duplicate Slack events must not mark binding errors.");
      },
      async retrieveSessionReply() {
        throw new Error("Duplicate Slack events must not poll session replies.");
      },
    };

    try {
      await processSlackWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          sessionLinkBaseUrl: "https://mosoo.ai",
          slackBotToken: "xoxb-token",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Duplicate Slack events must not schedule final delivery.");
          },
        },
        sessionClient,
        trigger: {
          botUserId: "U-BOT",
          channelId: "C123",
          enterpriseId: null,
          eventId: "Ev-duplicate",
          isEnterpriseInstall: false,
          messageTs: "1700000000.000100",
          requiresExistingSession: false,
          teamId: "T123",
          text: "ship it",
          threadTs: "1700000000.000100",
          triggerType: "app_mention",
          userId: "U-ALICE",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchUrls).toEqual([]);
  });

  test("marks the binding error when Slack writeback rejects the bot token", async () => {
    const errorCodes: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    globalThis.fetch = async () => Response.json({ error: "invalid_auth", ok: false });
    globalThis.reportError = () => {};
    const sessionClient: SlackSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        errorCodes.push(errorCode);
      },
      async retrieveSessionReply() {
        return { status: "completed", text: "done" };
      },
    };

    try {
      await processSlackWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          sessionLinkBaseUrl: "https://mosoo.ai",
          slackBotToken: "xoxb-invalid",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Failed Slack working reply must not schedule final delivery.");
          },
        },
        sessionClient,
        trigger: {
          botUserId: "U-BOT",
          channelId: "C123",
          enterpriseId: null,
          eventId: "Ev-invalid-auth",
          isEnterpriseInstall: false,
          messageTs: "1700000000.000100",
          requiresExistingSession: false,
          teamId: "T123",
          text: "ship it",
          threadTs: "1700000000.000100",
          triggerType: "app_mention",
          userId: "U-ALICE",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }

    expect(errorCodes).toContain("invalid_auth");
  });

  test("maps malformed Slack Web API JSON to typed operation errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("{", {
        headers: { "content-type": "application/json" },
        status: 200,
      });

    try {
      await expect(
        new SlackWebApiClient("xoxb-token").postChatMessage({
          channelId: "C123",
          text: "Agent is working...",
          threadTs: "1700000000.000100",
        }),
      ).rejects.toEqual(new SlackWebApiError("chat.postMessage", "chat.postMessage_failed"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not mark the binding error for channel-scoped Slack writeback failures", async () => {
    const errorCodes: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalReportError = globalThis.reportError;
    globalThis.fetch = async () => Response.json({ error: "channel_not_found", ok: false });
    globalThis.reportError = () => {};
    const sessionClient: SlackSessionCommandClient = {
      async createOrContinueSession() {
        return { duplicate: false, runId: "run-1", sessionId: "session-1" };
      },
      async markBindingError(errorCode) {
        errorCodes.push(errorCode);
      },
      async retrieveSessionReply() {
        return { status: "completed", text: "done" };
      },
    };

    try {
      await processSlackWorkTrigger({
        config: {
          agentId: "01J00000000000000000000009",
          bindingId: "binding-1",
          sessionLinkBaseUrl: "https://mosoo.ai",
          slackBotToken: "xoxb-valid",
        },
        finalDeliveryScheduler: {
          async enqueue() {
            throw new Error("Failed Slack working reply must not schedule final delivery.");
          },
        },
        sessionClient,
        trigger: {
          botUserId: "U-BOT",
          channelId: "C-missing",
          enterpriseId: null,
          eventId: "Ev-channel-missing",
          isEnterpriseInstall: false,
          messageTs: "1700000000.000100",
          requiresExistingSession: false,
          teamId: "T123",
          text: "ship it",
          threadTs: "1700000000.000100",
          triggerType: "app_mention",
          userId: "U-ALICE",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.reportError = originalReportError;
    }

    expect(errorCodes).toEqual([]);
  });
});
