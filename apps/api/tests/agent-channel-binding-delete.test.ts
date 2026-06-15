import { describe, expect, test } from "bun:test";

import { agentChannelBindingsTable, appsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";
import { count, eq } from "drizzle-orm";

import {
  createDiscordAgentChannelBinding,
  createSlackAgentChannelBinding,
  deleteAgentChannelBinding,
  listAgentChannelBindings,
} from "../src/modules/channels/application/agent-channel-binding.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  EXTERNAL_VIEWER,
  OWNER_VIEWER,
  createChannelConnectionNamespaceForDeleteTest,
  withDiscordCurrentUserMock,
  withSlackAuthTestMock,
} from "./agent-channel-binding-fixtures";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

describe("agent channel binding deletion", () => {
  test("marks Discord bindings inactive before stopping the Gateway connection during delete", async () => {
    await withDiscordCurrentUserMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const stoppedRows: Array<{ lastErrorCode: string | null; status: string }> = [];
      const bindings = {
        ...createPublicHttpTestBindings(database),
        ChannelConnection: createChannelConnectionNamespaceForDeleteTest(async (bindingId) => {
          const row = await database
            .app()
            .select({
              lastErrorCode: agentChannelBindingsTable.lastErrorCode,
              status: agentChannelBindingsTable.status,
            })
            .from(agentChannelBindingsTable)
            .where(eq(agentChannelBindingsTable.id, bindingId))
            .get();

          if (!row) {
            throw new Error("Expected Discord binding row to exist before owner stop.");
          }

          stoppedRows.push(row);
        }),
      } as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        applicationId: "discord-app-1",
        botToken: "discord-token",
        appId: PUBLIC_API_TEST_IDS.app,
        relaySecret: "discord-relay-secret",
      });

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
        bindingId: binding.id,
        appId: PUBLIC_API_TEST_IDS.app,
      });

      expect(stoppedRows).toEqual([{ lastErrorCode: "binding_deleting", status: "error" }]);
      const bindingCount = await database
        .app()
        .select({ count: count() })
        .from(agentChannelBindingsTable)
        .get();
      expect(bindingCount?.count).toBe(0);
    });
  });

  test("deletes Discord bindings even when Gateway connection stop fails", async () => {
    await withDiscordCurrentUserMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = {
        ...createPublicHttpTestBindings(database),
        ChannelConnection: createChannelConnectionNamespaceForDeleteTest(async () => {
          throw new Error("Gateway connection unavailable");
        }),
      } as ApiBindings;
      const binding = await createDiscordAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        applicationId: "discord-app-1",
        botToken: "discord-token",
        appId: PUBLIC_API_TEST_IDS.app,
        relaySecret: "discord-relay-secret",
      });

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
        bindingId: binding.id,
        appId: PUBLIC_API_TEST_IDS.app,
      });

      const bindingCount = await database
        .app()
        .select({ count: count() })
        .from(agentChannelBindingsTable)
        .get();

      expect(bindingCount?.count).toBe(0);
    });
  });

  test("requires owner access to list or delete bindings", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });

      await expect(
        listAgentChannelBindings(database, EXTERNAL_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
        }),
      ).rejects.toThrow();
      await expect(
        deleteAgentChannelBinding(bindings, EXTERNAL_VIEWER, {
          bindingId: binding.id,
          appId: PUBLIC_API_TEST_IDS.app,
        }),
      ).rejects.toThrow();

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
        bindingId: binding.id,
        appId: PUBLIC_API_TEST_IDS.app,
      });

      const bindingCount = await database
        .app()
        .select({ count: count() })
        .from(agentChannelBindingsTable)
        .get();

      expect(bindingCount?.count).toBe(0);
    });
  });

  test("rejects owner operations when the Agent belongs to another App", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const nowMs = Date.now();
      const otherAppId = "01J000000000000000000000ZZ" as AppId;

      await database
        .app()
        .insert(appsTable)
        .values({
          createdAt: nowMs,
          defaultEnvironmentId: PUBLIC_API_TEST_IDS.environment,
          id: otherAppId,
          name: "Other App",
          organizationId: PUBLIC_API_TEST_IDS.organization,
          ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
          slug: "other-app",
          updatedAt: nowMs,
        })
        .run();

      await expect(
        createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          botToken: "xoxb-secret-token",
          appId: otherAppId,
          signingSecret: "signing-secret",
        }),
      ).rejects.toThrow();

      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        botToken: "xoxb-secret-token",
        appId: PUBLIC_API_TEST_IDS.app,
        signingSecret: "signing-secret",
      });

      await expect(
        listAgentChannelBindings(database, OWNER_VIEWER, {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: otherAppId,
        }),
      ).rejects.toThrow();
      await expect(
        deleteAgentChannelBinding(bindings, OWNER_VIEWER, {
          bindingId: binding.id,
          appId: otherAppId,
        }),
      ).rejects.toThrow();
    });
  });
});
