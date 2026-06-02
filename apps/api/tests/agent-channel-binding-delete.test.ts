import { describe, expect, test } from "bun:test";

import { agentChannelBindingsTable } from "@mosoo/db";
import { count, eq } from "drizzle-orm";

import {
  createDiscordAgentChannelBinding,
  createSlackAgentChannelBinding,
  deleteAgentChannelBinding,
  listAgentChannelBindings,
} from "../src/modules/channels/application/agent-channel-binding.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  COLLABORATOR_VIEWER,
  OWNER_VIEWER,
  createChannelConnectionNamespaceForDeleteTest,
  withDiscordCurrentUserMock,
  withSlackAuthTestMock,
} from "./agent-channel-binding-fixtures";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/published-agent-http-test-fixture";

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
        agentId: "01J00000000000000000000009",
        applicationId: "discord-app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, { bindingId: binding.id });

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
        agentId: "01J00000000000000000000009",
        applicationId: "discord-app-1",
        botToken: "discord-token",
        relaySecret: "discord-relay-secret",
      });

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, { bindingId: binding.id });

      const bindingCount = await database
        .app()
        .select({ count: count() })
        .from(agentChannelBindingsTable)
        .get();

      expect(bindingCount?.count).toBe(0);
    });
  });

  test("allows readable users to list but only editors to delete bindings", async () => {
    await withSlackAuthTestMock(async () => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const binding = await createSlackAgentChannelBinding(bindings, OWNER_VIEWER, {
        agentId: "01J00000000000000000000009",
        botToken: "xoxb-secret-token",
        signingSecret: "signing-secret",
      });

      await expect(
        listAgentChannelBindings(database, COLLABORATOR_VIEWER, "01J00000000000000000000009"),
      ).resolves.toHaveLength(1);
      await expect(
        deleteAgentChannelBinding(bindings, COLLABORATOR_VIEWER, { bindingId: binding.id }),
      ).rejects.toThrow();

      await deleteAgentChannelBinding(bindings, OWNER_VIEWER, { bindingId: binding.id });

      const bindingCount = await database
        .app()
        .select({ count: count() })
        .from(agentChannelBindingsTable)
        .get();

      expect(bindingCount?.count).toBe(0);
    });
  });
});
