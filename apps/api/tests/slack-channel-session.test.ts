import { describe, expect, test } from "bun:test";

import {
  channelEventReceiptsTable,
  channelThreadSessionsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { and, count, desc, eq } from "drizzle-orm";

import {
  createSlackAgentChannelBinding,
  deleteAgentChannelBinding,
  listAgentChannelBindings,
} from "../src/modules/channels/application/agent-channel-binding.service";
import {
  createSlackChannelSessionClient,
  resolveSlackChannelBindingContext,
} from "../src/modules/channels/application/slack-channel-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import {
  OWNER_VIEWER,
  buildSlackTrigger,
  markLatestSessionRunCompleted,
  parseJsonRecord,
  readRecord,
  withChannelFetchMock,
} from "./slack-channel-session-fixtures";

describe("Slack channel sessions", () => {
  test("creates api_channel session metadata, reuses thread, and deduplicates event id", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const threadTs = "1700000000.000100";
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });
      expect(binding).not.toBeNull();

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
        clientRequestId: "slack:event:Ev-first",
        text: "Review the launch plan.",
        trigger: buildSlackTrigger({
          eventId: "Ev-first",
          messageTs: threadTs,
          text: "Review the launch plan.",
        }),
      });
      const sessionRow = await database
        .app()
        .select({
          attributedUserId: sessionsTable.attributedUserId,
          creatorAccountId: sessionsTable.creatorAccountId,
          metadataJson: sessionsTable.metadataJson,
          type: sessionsTable.type,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, first.sessionId))
        .get();
      expect(sessionRow).toMatchObject({
        attributedUserId: null,
        creatorAccountId: "01J00000000000000000000001",
        type: "api_channel",
      });
      const metadata = parseJsonRecord(sessionRow?.metadataJson ?? "{}");
      const triggeredBy = readRecord(metadata["triggered_by"], "triggered_by");
      expect(triggeredBy).toMatchObject({
        event_id: "Ev-first",
        external_actor_id: "slack:U-ALICE",
        external_message_id: "1700000000.000100",
        external_thread_id: "C123:1700000000.000100",
        external_workspace_id: "T123",
        provider: "slack",
      });
      expect(triggeredBy["binding_id"]).toBe(binding.bindingId);
      expect(readRecord(triggeredBy["provider_metadata"], "provider_metadata")).toMatchObject({
        bot_handle: "mosoobot",
        channel_id: "C123",
        team_id: "T123",
        workspace_name: "Growth HQ",
      });
      const threadSessionRowsAfterFirst = await database
        .app()
        .select({
          externalThreadId: channelThreadSessionsTable.externalThreadId,
          provider: channelThreadSessionsTable.provider,
          sessionId: channelThreadSessionsTable.sessionId,
        })
        .from(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.bindingId))
        .all();
      expect(threadSessionRowsAfterFirst).toEqual([
        {
          externalThreadId: "C123:1700000000.000100",
          provider: "slack",
          sessionId: first.sessionId,
        },
      ]);

      await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-first",
        text: "Review the launch plan.",
        trigger: buildSlackTrigger({
          eventId: "Ev-first",
          messageTs: threadTs,
          text: "Review the launch plan.",
        }),
      });
      const messageCountAfterDuplicate = await database
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
      expect(messageCountAfterDuplicate?.value).toBe(1);

      await expect(
        listAgentChannelBindings(database, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          activityLastTriggeredAt: expect.any(String),
          activitySessionCount7d: 1,
          id: binding.bindingId,
        }),
      ]);

      const run = await database
        .app()
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(eq(sessionRunsTable.sessionId, first.sessionId))
        .orderBy(desc(sessionRunsTable.createdAt))
        .limit(1)
        .get();
      expect(run?.id).toBeString();

      await database
        .app()
        .update(sessionRunsTable)
        .set({ completedAt: Date.now(), status: "completed", updatedAt: Date.now() })
        .where(eq(sessionRunsTable.id, run?.id ?? ""))
        .run();
      await database
        .app()
        .update(sessionsTable)
        .set({ lastRunId: run?.id ?? null, status: "IDLE", updatedAt: Date.now() })
        .where(eq(sessionsTable.id, first.sessionId))
        .run();
      await database
        .app()
        .insert(sessionMessagesTable)
        .values({
          contentText: "Finished from session.",
          createdAt: Date.now(),
          createdByAccountId: "01J00000000000000000000001",
          id: "assistant-message-1",
          planJson: null,
          role: "assistant",
          segmentsJson: null,
          seq: 2,
          sessionId: first.sessionId,
          sessionRunId: run?.id ?? null,
        })
        .run();
      await database
        .app()
        .update(sessionsTable)
        .set({ messageSeqCursor: 2 })
        .where(eq(sessionsTable.id, first.sessionId))
        .run();
      if (!first.runId) {
        throw new Error("Expected first Slack command to create a run.");
      }

      await expect(
        client.retrieveSessionReply(first.sessionId ?? "", first.runId),
      ).resolves.toEqual({
        status: "completed",
        text: "Finished from session.",
      });

      const followUp = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-follow-up",
        text: "Now list risks.",
        trigger: buildSlackTrigger({
          eventId: "Ev-follow-up",
          messageTs: "1700000000.000200",
          text: "Now list risks.",
          threadTs,
        }),
      });
      expect(followUp.sessionId).toBe(first.sessionId);
      await markLatestSessionRunCompleted(database, first.sessionId ?? "");
      const threadSessionCountAfterFollowUp = await database
        .app()
        .select({ value: count() })
        .from(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.bindingId))
        .get();
      expect(threadSessionCountAfterFollowUp?.value).toBe(1);

      const threadFollowUp = await client.createOrContinueSession({
        clientRequestId: "slack:event:Ev-thread-follow-up",
        text: "Continue without a mention.",
        trigger: buildSlackTrigger({
          eventId: "Ev-thread-follow-up",
          messageTs: "1700000000.000300",
          requiresExistingSession: true,
          text: "Continue without a mention.",
          threadTs,
          triggerType: "channel_thread_message",
        }),
      });
      expect(threadFollowUp).toMatchObject({
        duplicate: false,
        ignored: false,
        sessionId: first.sessionId,
      });

      const messageCountAfterFollowUp = await database
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
      expect(messageCountAfterFollowUp?.value).toBe(3);
    });
  });

  test("does not reuse Slack sessions across rebinding to another tenant", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    let firstSessionId = "";

    await withChannelFetchMock(async () => {
      const firstBinding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-first-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "first-signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected first Slack binding context.");
      }

      const first = await createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      }).createOrContinueSession({
        clientRequestId: "slack:event:Ev-first-tenant",
        text: "First tenant.",
        trigger: buildSlackTrigger({
          eventId: "Ev-first-tenant",
          messageTs: "1700000000.000400",
          text: "First tenant.",
        }),
      });
      firstSessionId = first.sessionId ?? "";

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
        bindingId: firstBinding.id,
        appId: PUBLIC_API_TEST_IDS.app,
      });
    });

    await withChannelFetchMock(
      async () => {
        await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          botToken: "xoxb-second-token",
          appId: PUBLIC_API_TEST_IDS.app,
          signingSecret: "second-signing-secret",
        });
        const binding = await resolveSlackChannelBindingContext(bindings, {
          externalBotId: "U-BOT",
          externalTenantId: "T456",
        });

        if (!binding) {
          throw new Error("Expected second Slack binding context.");
        }

        const second = await createSlackChannelSessionClient({
          binding,
          bindings,
          executionContext: createTestExecutionContext(),
          requestUrl: "https://api.example.com/api/v1/channels/slack/events",
        }).createOrContinueSession({
          clientRequestId: "slack:event:Ev-second-tenant",
          text: "Second tenant.",
          trigger: {
            ...buildSlackTrigger({
              eventId: "Ev-second-tenant",
              messageTs: "1700000000.000500",
              text: "Second tenant.",
            }),
            teamId: "T456",
          },
        });

        expect(second.sessionId).toBeString();
        expect(second.sessionId).not.toBe(firstSessionId);
      },
      {
        ok: true,
        team: "Enterprise HQ",
        team_id: "T456",
        user: "mosoobot",
        user_id: "U-BOT",
      },
    );

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

    expect(sessionCount?.value).toBe(2);
  });

  test("reclaims stale incomplete Slack event receipts", async () => {
    await withChannelFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });
      const binding = await resolveSlackChannelBindingContext(bindings, {
        externalBotId: "U-BOT",
        externalTenantId: "T123",
      });

      if (!binding) {
        throw new Error("Expected Slack binding context.");
      }

      const staleTimestamp = Date.now() - 10 * 60 * 1000;
      await database
        .app()
        .insert(channelEventReceiptsTable)
        .values({
          bindingId: binding.bindingId,
          createdAt: staleTimestamp,
          expiresAt: Date.now() + 60_000,
          externalEventId: "slack:event:Ev-stale",
          externalTenantId: "T123",
          id: "stale-receipt",
          provider: "slack",
          sessionId: null,
          updatedAt: staleTimestamp,
        })
        .run();

      const result = await createSlackChannelSessionClient({
        binding,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/slack/events",
      }).createOrContinueSession({
        clientRequestId: "slack:event:Ev-stale",
        text: "Recover stale receipt.",
        trigger: buildSlackTrigger({
          eventId: "Ev-stale",
          messageTs: "1700000000.000600",
          text: "Recover stale receipt.",
        }),
      });

      const receipt = await database
        .app()
        .select({
          id: channelEventReceiptsTable.id,
          sessionId: channelEventReceiptsTable.sessionId,
        })
        .from(channelEventReceiptsTable)
        .where(eq(channelEventReceiptsTable.externalEventId, "slack:event:Ev-stale"))
        .get();

      expect(result.duplicate).toBe(false);
      expect(result.sessionId).toBeString();
      expect(receipt?.id).not.toBe("stale-receipt");
      expect(receipt?.sessionId).toBe(result.sessionId);
    });
  });
});
