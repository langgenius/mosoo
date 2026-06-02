import { describe, expect, test } from "bun:test";

import {
  channelEventReceiptsTable,
  channelThreadSessionsTable,
  sessionMessagesTable,
  sessionsTable,
} from "@mosoo/db";
import { and, count, eq } from "drizzle-orm";

import { createSlackAgentChannelBinding } from "../src/modules/channels/application/agent-channel-binding.service";
import {
  createSlackChannelSessionClient,
  resolveSlackChannelBindingContext,
} from "../src/modules/channels/application/slack-channel-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/published-agent-http-test-fixture";
import {
  OWNER_VIEWER,
  buildSlackTrigger,
  markLatestSessionRunCompleted,
  withChannelFetchMock,
} from "./slack-channel-session-fixtures";

describe("Slack channel session threading", () => {
  test("honors strict thread-reply mention setting", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const threadTs = "1700000000.000800";
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
        threadRepliesRequireMention: true,
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected Slack binding context.");
      }

      const client = createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      });
      const first = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-strict-start",
        text: "Start strict thread.",
        trigger: buildSlackTrigger({
          eventId: "Ev-strict-start",
          messageTs: threadTs,
          text: "Start strict thread.",
        }),
      });
      await markLatestSessionRunCompleted(database, first.sessionId ?? "");

      const threadFollowUp = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-strict-thread",
        text: "Follow up without mention.",
        trigger: buildSlackTrigger({
          eventId: "Ev-strict-thread",
          messageTs: "1700000000.000900",
          requiresExistingSession: true,
          text: "Follow up without mention.",
          threadTs,
          triggerType: "channel_thread_message",
        }),
      });
      const messageCount = await database
        .app()
        .select({ value: count() })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, first.sessionId),
            eq(sessionMessagesTable.role, "user"),
          ),
        )
        .get();

      expect(binding.threadRepliesRequireMention).toBe(true);
      expect(threadFollowUp).toEqual({
        duplicate: false,
        ignored: true,
        runId: null,
        sessionId: null,
      });
      expect(messageCount?.value).toBe(1);
    });
  });

  test("ignores thread replies that do not have an existing channel session", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected Slack binding context.");
      }

      const result = await createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      }).createOrContinueSession({
        clientRequestId: "slack:event:Ev-orphan-thread",
        text: "Unmentioned orphan reply.",
        trigger: buildSlackTrigger({
          eventId: "Ev-orphan-thread",
          messageTs: "1700000000.000700",
          requiresExistingSession: true,
          text: "Unmentioned orphan reply.",
          threadTs: "1700000000.000100",
          triggerType: "channel_thread_message",
        }),
      });

      const sessionCount = await database
        .app()
        .select({ value: count() })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.agentId, "01J00000000000000000000009"),
            eq(sessionsTable.type, "api_channel"),
          ),
        )
        .get();
      const receiptCount = await database
        .app()
        .select({ value: count() })
        .from(channelEventReceiptsTable)
        .get();

      expect(result).toEqual({ duplicate: false, ignored: true, runId: null, sessionId: null });
      expect(sessionCount?.value).toBe(0);
      expect(receiptCount?.value).toBe(0);
    });
  });

  test("backfills thread session mapping from legacy metadata", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const threadTs = "1700000000.000700";
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected Slack binding context.");
      }

      const client = createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      });
      const first = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-legacy-first",
        text: "Start a thread.",
        trigger: buildSlackTrigger({
          eventId: "Ev-legacy-first",
          messageTs: threadTs,
          text: "Start a thread.",
        }),
      });

      if (!first.sessionId) {
        throw new Error("Expected Slack command to create a session.");
      }

      await markLatestSessionRunCompleted(database, first.sessionId);
      await database
        .app()
        .delete(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.bindingId))
        .run();

      const reply = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-legacy-reply",
        text: "Continue in the thread.",
        trigger: buildSlackTrigger({
          eventId: "Ev-legacy-reply",
          messageTs: "1700000000.000800",
          requiresExistingSession: true,
          text: "Continue in the thread.",
          threadTs,
          triggerType: "channel_thread_message",
        }),
      });

      expect(reply).toMatchObject({
        duplicate: false,
        ignored: false,
        sessionId: first.sessionId,
      });

      const mapping = await database
        .app()
        .select({
          externalThreadId: channelThreadSessionsTable.externalThreadId,
          sessionId: channelThreadSessionsTable.sessionId,
        })
        .from(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.bindingId))
        .get();

      expect(mapping).toEqual({
        externalThreadId: "C123:1700000000.000700",
        sessionId: first.sessionId,
      });
    });
  });

  test("reserves event ids before creating channel session side effects", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected Slack binding context.");
      }

      const client = createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      });
      const trigger = buildSlackTrigger({
        eventId: "Ev-concurrent",
        messageTs: "1700000000.000300",
        text: "Only run once.",
      });

      const results = await Promise.all([
        client.createOrContinueSession({
          clientRequestId: "slack:event:Ev-concurrent",
          text: "Only run once.",
          trigger,
        }),
        client.createOrContinueSession({
          clientRequestId: "slack:event:Ev-concurrent",
          text: "Only run once.",
          trigger,
        }),
      ]);

      expect(results.filter((result) => result.duplicate)).toHaveLength(1);
      expect(results.filter((result) => !result.duplicate)).toHaveLength(1);

      const sessionCount = await database
        .app()
        .select({ value: count() })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.agentId, "01J00000000000000000000009"),
            eq(sessionsTable.type, "api_channel"),
          ),
        )
        .get();
      const userMessageCount = await database
        .app()
        .select({ value: count() })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.role, "user"))
        .get();
      const receiptCount = await database
        .app()
        .select({ value: count() })
        .from(channelEventReceiptsTable)
        .get();

      expect(sessionCount?.value).toBe(1);
      expect(userMessageCount?.value).toBe(1);
      expect(receiptCount?.value).toBe(1);
    });
  });
});
