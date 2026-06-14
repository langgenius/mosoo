import { describe, expect, test } from "bun:test";

import { agentChannelBindingsTable, sessionsTable, vaultSecretsTable } from "@mosoo/db";
import { count, eq } from "drizzle-orm";

import { cleanupOrphanChannelBindingCredentialSecrets } from "../src/modules/channels/application/agent-channel-binding-maintenance.service";
import {
  createSlackAgentChannelBinding,
  listAgentChannelBindings,
} from "../src/modules/channels/application/agent-channel-binding.service";
import {
  deleteAgentChannelBindingCredentialSecret,
  readAgentChannelBindingCredentialSecret,
  storeAgentChannelBindingCredentialSecret,
} from "../src/modules/channels/application/channel-credential-secret-resolution";
import { readSecretOutcome, storeSecret } from "../src/modules/mcp/application/mcp-secret-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { OWNER_VIEWER, withSlackAuthTestMock } from "./agent-channel-binding-fixtures";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
describe("agent channel bindings", () => {
  test("loads channel activity for all bindings", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const secretId = await storeSecret(database, bindings, {
      kind: "test_channel_binding_credentials",
      value: "{}",
    });
    const nowMs = Date.now();

    await database
      .app()
      .insert(agentChannelBindingsTable)
      .values([
        {
          agentId: "01J00000000000000000000009",
          createdAt: nowMs,
          displayMetadataJson: "{}",
          encryptedCredsSecretId: secretId,
          externalBotId: "slack-bot",
          externalTenantId: "slack-tenant",
          id: "binding-slack",
          lastErrorCode: null,
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "slack",
          status: "active",
          updatedAt: nowMs,
        },
        {
          agentId: "01J00000000000000000000009",
          createdAt: nowMs,
          displayMetadataJson: "{}",
          encryptedCredsSecretId: secretId,
          externalBotId: "telegram-bot",
          externalTenantId: "telegram-tenant",
          id: "binding-telegram",
          lastErrorCode: null,
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "telegram",
          status: "active",
          updatedAt: nowMs,
        },
        {
          agentId: "01J00000000000000000000009",
          createdAt: nowMs,
          displayMetadataJson: "{}",
          encryptedCredsSecretId: secretId,
          externalBotId: "discord-bot",
          externalTenantId: "discord-tenant",
          id: "binding-discord",
          lastErrorCode: null,
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "discord",
          status: "active",
          updatedAt: nowMs,
        },
      ])
      .run();

    await database
      .app()
      .insert(sessionsTable)
      .values([
        {
          agentId: "01J00000000000000000000009",
          archivedAt: null,
          attributedUserId: null,
          createdAt: nowMs - 10,
          creatorAccountId: "01J00000000000000000000001",
          deploymentVersionId: "01J0000000000000000000000A",
          deploymentVersionNumber: 1,
          id: "session-slack-old",
          kind: "pet",
          lastMessageAt: null,
          lastRunId: null,
          metadataJson: JSON.stringify({ triggered_by: { binding_id: "binding-slack" } }),
          model: "gpt-5.4",
          organizationId: "01J00000000000000000000006",
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "openai",
          renamed: false,
          runtimeId: "openai-runtime",
          status: "IDLE",
          title: null,
          type: "api_channel",
          updatedAt: nowMs - 10,
        },
        {
          agentId: "01J00000000000000000000009",
          archivedAt: null,
          attributedUserId: null,
          createdAt: nowMs,
          creatorAccountId: "01J00000000000000000000001",
          deploymentVersionId: "01J0000000000000000000000A",
          deploymentVersionNumber: 1,
          id: "session-slack-new",
          kind: "pet",
          lastMessageAt: null,
          lastRunId: null,
          metadataJson: JSON.stringify({ triggered_by: { binding_id: "binding-slack" } }),
          model: "gpt-5.4",
          organizationId: "01J00000000000000000000006",
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "openai",
          renamed: false,
          runtimeId: "openai-runtime",
          status: "IDLE",
          title: null,
          type: "api_channel",
          updatedAt: nowMs,
        },
        {
          agentId: "01J00000000000000000000009",
          archivedAt: null,
          attributedUserId: null,
          createdAt: nowMs,
          creatorAccountId: "01J00000000000000000000001",
          deploymentVersionId: "01J0000000000000000000000A",
          deploymentVersionNumber: 1,
          id: "session-telegram",
          kind: "pet",
          lastMessageAt: null,
          lastRunId: null,
          metadataJson: JSON.stringify({ triggered_by: { binding_id: "binding-telegram" } }),
          model: "gpt-5.4",
          organizationId: "01J00000000000000000000006",
          appId: PUBLIC_API_TEST_IDS.app,
          provider: "openai",
          renamed: false,
          runtimeId: "openai-runtime",
          status: "IDLE",
          title: null,
          type: "api_channel",
          updatedAt: nowMs,
        },
      ])
      .run();
    const results = await listAgentChannelBindings(database, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      appId: PUBLIC_API_TEST_IDS.app,
    });
    expect(results).toContainEqual(
      expect.objectContaining({
        activityLastTriggeredAt: new Date(nowMs).toISOString(),
        activitySessionCount7d: 2,
        id: "binding-slack",
      }),
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        activityLastTriggeredAt: new Date(nowMs).toISOString(),
        activitySessionCount7d: 1,
        id: "binding-telegram",
      }),
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        activityLastTriggeredAt: null,
        activitySessionCount7d: 0,
        id: "binding-discord",
      }),
    );
  });

  test("creates Slack binding credentials through vault secret storage", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;

      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });

      expect(binding).toMatchObject({
        agentId: "01J00000000000000000000009",
        displayMetadata: {
          bot_handle: "mosoobot",
          workspace_name: "Growth HQ",
        },
        externalBotId: "U-BOT",
        externalTenantId: "T123",
        provider: "slack",
        status: "active",
      });

      const row = await database
        .app()
        .select()
        .from(agentChannelBindingsTable)
        .where(eq(agentChannelBindingsTable.id, binding.id))
        .get();

      expect(row?.encryptedCredsSecretId).toBeString();
      expect(JSON.stringify(row)).not.toContain("xoxb-secret-token");

      if (!row) {
        throw new Error("Expected Slack binding row.");
      }

      const decrypted = await readAgentChannelBindingCredentialSecret(bindings, {
        bindingId: binding.id,
        expectedOwner: {
          agentId: binding.agentId,
          appId: PUBLIC_API_TEST_IDS.app,
        },
        provider: "slack",
        purpose: "channel_callback",
        secretId: row.encryptedCredsSecretId,
      });
      expect(JSON.parse(decrypted)).toEqual({
        appLevelToken: null,
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
        threadRepliesRequireMention: false,
      });

      const unrelatedSecretId = await storeSecret(database, bindings, {
        kind: "test_unrelated_channel_binding_credentials",
        value: "{}",
      });
      await expect(
        readAgentChannelBindingCredentialSecret(bindings, {
          bindingId: binding.id,
          expectedOwner: {
            agentId: binding.agentId,
            appId: PUBLIC_API_TEST_IDS.app,
          },
          provider: "slack",
          purpose: "channel_callback",
          secretId: unrelatedSecretId,
        }),
      ).rejects.toThrow();
      await expect(
        readAgentChannelBindingCredentialSecret(bindings, {
          bindingId: binding.id,
          expectedOwner: {
            agentId: binding.agentId,
            appId: "01J00000000000000000000099",
          },
          provider: "slack",
          purpose: "channel_callback",
          secretId: row.encryptedCredsSecretId,
        }),
      ).rejects.toThrow();

      await database
        .app()
        .delete(vaultSecretsTable)
        .where(eq(vaultSecretsTable.id, row.encryptedCredsSecretId))
        .run();
      await expect(
        readAgentChannelBindingCredentialSecret(bindings, {
          bindingId: binding.id,
          expectedOwner: {
            agentId: binding.agentId,
            appId: PUBLIC_API_TEST_IDS.app,
          },
          provider: "slack",
          purpose: "channel_callback",
          secretId: row.encryptedCredsSecretId,
        }),
      ).rejects.toThrow();
    });
  });

  test("deletes channel credentials only through the expected owner context", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const slackSecretId = await storeAgentChannelBindingCredentialSecret(bindings, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      credentialsJson: "{}",
      appId: PUBLIC_API_TEST_IDS.app,
      provider: "slack",
      purpose: "channel_binding_create",
    });
    const telegramSecretId = await storeAgentChannelBindingCredentialSecret(bindings, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      credentialsJson: "{}",
      appId: PUBLIC_API_TEST_IDS.app,
      provider: "telegram",
      purpose: "channel_binding_create",
    });

    await expect(
      deleteAgentChannelBindingCredentialSecret(database, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        provider: "slack",
        purpose: "channel_binding_delete",
        secretId: telegramSecretId,
      }),
    ).resolves.toMatchObject({
      status: "denied",
    });

    const wrongOwnerSecretCount = await database
      .app()
      .select({ count: count() })
      .from(vaultSecretsTable)
      .where(eq(vaultSecretsTable.id, telegramSecretId))
      .get();
    expect(wrongOwnerSecretCount?.count).toBe(1);

    await expect(
      deleteAgentChannelBindingCredentialSecret(database, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        appId: PUBLIC_API_TEST_IDS.app,
        provider: "slack",
        purpose: "channel_binding_delete",
        secretId: slackSecretId,
      }),
    ).resolves.toEqual({ status: "deleted" });

    const deletedSecretCount = await database
      .app()
      .select({ count: count() })
      .from(vaultSecretsTable)
      .where(eq(vaultSecretsTable.id, slackSecretId))
      .get();
    expect(deletedSecretCount?.count).toBe(0);
  });

  test("repairs orphaned channel credential secrets after replacement", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });
      const oldBindingRow = await database
        .app()
        .select()
        .from(agentChannelBindingsTable)
        .where(eq(agentChannelBindingsTable.id, binding.id))
        .get();

      if (!oldBindingRow) {
        throw new Error("Expected Slack binding row.");
      }

      const replacementSecretId = await storeAgentChannelBindingCredentialSecret(bindings, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        credentialsJson: "{}",
        appId: PUBLIC_API_TEST_IDS.app,
        provider: "slack",
        purpose: "channel_binding_update",
      });
      await database
        .app()
        .update(agentChannelBindingsTable)
        .set({ encryptedCredsSecretId: replacementSecretId })
        .where(eq(agentChannelBindingsTable.id, binding.id))
        .run();

      await expect(
        cleanupOrphanChannelBindingCredentialSecrets(bindings, new Date(), { limit: 10 }),
      ).resolves.toEqual({
        deleted: 1,
        failed: 0,
        skipped: 0,
        total: 1,
      });

      await expect(
        readSecretOutcome(database, bindings, oldBindingRow.encryptedCredsSecretId),
      ).resolves.toMatchObject({ status: "missing" });
      await expect(
        readSecretOutcome(database, bindings, replacementSecretId),
      ).resolves.toMatchObject({
        status: "found",
      });
    });
  });
});
