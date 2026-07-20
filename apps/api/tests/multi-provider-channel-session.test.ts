import { describe, expect, test } from "bun:test";

import { channelThreadSessionsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import {
  createLarkAgentChannelBinding,
  createTelegramAgentChannelBinding,
} from "../src/modules/channels/application/agent-channel-binding.service";
import {
  createChannelSessionClient,
  resolveAgentChannelBindingContextById,
} from "../src/modules/channels/application/channel-session.service";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { OWNER_VIEWER, parseJsonRecord, readRecord } from "./channel-session-fixtures";
import { readFetchUrl } from "./helpers/fetch-request-url";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

async function withProviderFetchMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = readFetchUrl(url);

    if (requestUrl === "https://api.telegram.org/bottelegram-token/getMe") {
      return Response.json({
        ok: true,
        result: {
          first_name: "mosoo Telegram",
          id: 9001,
          is_bot: true,
          username: "mosoo_telegram_bot",
        },
      });
    }

    if (
      requestUrl === "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" ||
      requestUrl === "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
    ) {
      return Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      });
    }

    if (
      requestUrl === "https://open.feishu.cn/open-apis/bot/v3/info" ||
      requestUrl === "https://open.larksuite.com/open-apis/bot/v3/info"
    ) {
      return Response.json({
        bot: {
          app_name: "mosoo Lark",
          open_id: "ou_bot",
        },
        code: 0,
      });
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("multi-provider channel sessions", () => {
  test("creates Telegram bindings through vault and channel sessions with provider metadata", async () => {
    await withProviderFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createTelegramAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "telegram-token",
        appId: PUBLIC_API_TEST_IDS.app,
        webhookSecret: "telegram-webhook-secret",
      });

      expect(binding).toMatchObject({
        agentId: "01J00000000000000000000009",
        displayMetadata: {
          bot_first_name: "mosoo Telegram",
          bot_username: "mosoo_telegram_bot",
        },
        externalBotId: "9001",
        externalTenantId: "9001",
        provider: "telegram",
        status: "active",
      });

      const context = await resolveAgentChannelBindingContextById(bindings, {
        bindingId: binding.id,
        provider: "telegram",
      });
      expect(context).not.toBeNull();
      if (!context) {
        throw new Error("Expected Telegram binding context.");
      }

      const client = createChannelSessionClient({
        binding: context,
        bindings,
        executionContext: createTestExecutionContext(),
        requestUrl: "https://api.example.com/api/v1/channels/telegram/events/binding",
      });
      const command = await client.createOrContinueSession({
        clientRequestId: "telegram:update:1",
        text: "Review the launch plan.",
        trigger: {
          eventId: "telegram:update:1",
          externalActorId: "telegram:user:42",
          externalMessageId: "42:77",
          externalThreadId: "42:main",
          externalWorkspaceId: "42",
          providerMetadata: {
            chat_id: "42",
            message_id: 77,
          },
          requiresExistingSession: false,
        },
      });

      if (!command.sessionId) {
        throw new Error("Expected Telegram command to create a session.");
      }

      if (!command.runId) {
        throw new Error("Expected Telegram command to create a run.");
      }

      await setSessionRunStatus(database, {
        error: {
          code: "test.completed",
          details: {},
          message: "Test completed the synthetic channel run.",
          retryable: false,
        },
        runId: command.runId,
        source: "driver",
        status: "failed",
      });

      const followUp = await client.createOrContinueSession({
        clientRequestId: "telegram:update:2",
        text: "Now list the risks.",
        trigger: {
          eventId: "telegram:update:2",
          externalActorId: "telegram:user:42",
          externalMessageId: "42:78",
          externalThreadId: "42:main",
          externalWorkspaceId: "42",
          providerMetadata: {
            chat_id: "42",
            message_id: 78,
          },
          requiresExistingSession: false,
        },
      });

      expect(followUp.sessionId).toBe(command.sessionId);

      const sessionRow = await database
        .app()
        .select({
          attributedUserId: sessionsTable.attributedUserId,
          metadataJson: sessionsTable.metadataJson,
          type: sessionsTable.type,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, command.sessionId))
        .get();

      expect(sessionRow).toMatchObject({
        attributedUserId: null,
        type: "api_channel",
      });
      const metadata = parseJsonRecord(sessionRow?.metadataJson ?? "{}");
      expect(readRecord(metadata["triggered_by"], "triggered_by")).toMatchObject({
        binding_id: binding.id,
        external_actor_id: "telegram:user:42",
        external_message_id: "42:77",
        external_thread_id: "42:main",
        external_workspace_id: "42",
        provider: "telegram",
      });

      const runRow = await database
        .app()
        .select({
          createdByAccountId: sessionRunsTable.createdByAccountId,
          trigger: sessionRunsTable.trigger,
        })
        .from(sessionRunsTable)
        .where(eq(sessionRunsTable.id, command.runId))
        .get();

      expect(runRow).toEqual({
        createdByAccountId: OWNER_VIEWER.id,
        trigger: "user_prompt",
      });

      const threadSessionRows = await database
        .app()
        .select()
        .from(channelThreadSessionsTable)
        .where(eq(channelThreadSessionsTable.bindingId, binding.id))
        .all();

      expect(threadSessionRows).toEqual([
        expect.objectContaining({
          externalThreadId: "42:main",
          provider: "telegram",
          sessionId: command.sessionId,
        }),
      ]);
    });
  });

  test("creates one Lark provider with domain-specific credentials instead of separate Feishu enum", async () => {
    await withProviderFetchMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createLarkAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        larkAppId: "cli_feishu",
        appSecret: "app-secret",
        connectionMode: "webhook",
        domain: "feishu",
        encryptKey: "encrypt-key",
        appId: PUBLIC_API_TEST_IDS.app,
        verificationToken: "verification-token",
      });

      expect(binding).toMatchObject({
        displayMetadata: {
          app_name: "mosoo Lark",
          bot_open_id: "ou_bot",
          domain: "feishu",
        },
        externalBotId: "ou_bot",
        externalTenantId: "feishu:cli_feishu",
        provider: "lark",
      });
    });
  });
});
