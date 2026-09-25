import { describe, expect, test } from "bun:test";

import {
  createAgent,
  updateAgentConfig,
} from "../src/modules/agents/application/agent-command.service";
import { createAgentFork } from "../src/modules/agents/application/agent-fork.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createApiTestFixture } from "./helpers/api-test-fixture";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/public-api-http-test-fixture";

const ownerViewer: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5.4" }] });
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}

describe("Agent type retirement", () => {
  test.each([false, true])(
    "configuration saves do not select or overwrite kind (concurrent migration: %s)",
    async (migrating) => {
      const { database, viewer, ids } = await createApiTestFixture();
      if (migrating) {
        const originalBatch = database.batch.bind(database);
        database.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
          await database
            .prepare("UPDATE agent SET kind = 'cattle' WHERE id = ?")
            .bind(ids.agentId)
            .run();
          return originalBatch<T>(statements);
        };
      }
      const result = await updateAgentConfig(database, viewer, {
        agentId: ids.agentId,
        projectId: ids.projectId,
        kind: migrating ? "pet" : "cattle",
        name: "Edited configuration",
        description: null,
        environment: { environmentId: null },
        mcpServerIds: [],
        model: "gpt-5.4",
        prompt: "New instructions for later admission.",
        provider: "openai",
        providerOptions: {},
        runtimeId: "openai-runtime",
        skillIds: [],
      });
      expect(result).not.toHaveProperty("kind");
      expect(
        await database.prepare("SELECT kind FROM agent WHERE id = ?").bind(ids.agentId).first(),
      ).toEqual({ kind: migrating ? "cattle" : "pet" });
      expect(result.prompt).toBe("New instructions for later admission.");
    },
  );

  test.each([undefined, null, "pet", "cattle"] as const)(
    "creation cannot select shared execution with legacy kind %s",
    async (kind) => {
      const database = await createPublicHttpContractDatabase();
      const agent = await withProviderProbeMock(() =>
        createAgent(createPublicHttpTestBindings(database) as ApiBindings, ownerViewer, {
          ...(kind === undefined ? {} : { kind }),
          model: "gpt-5.4",
          name: "Session preset",
          projectId: PUBLIC_API_TEST_IDS.project,
          prompt: "Retain this configuration.",
          provider: "openai",
          runtimeId: "openai-runtime",
          skillIds: [],
        }),
      );
      expect(agent).not.toHaveProperty("kind");
      expect(agent).toMatchObject({
        model: "gpt-5.4",
        prompt: "Retain this configuration.",
      });
      expect(
        await database.prepare("SELECT kind FROM agent WHERE id = ?").bind(agent.id).first(),
      ).toEqual({ kind: "cattle" });
      expect(
        await database
          .prepare("SELECT kind FROM agent WHERE id = ?")
          .bind(PUBLIC_API_TEST_IDS.agent)
          .first(),
      ).toEqual({ kind: "pet" });
    },
  );

  test.each([undefined, "pet", "cattle"] as const)(
    "fork copies configuration without inheriting a shared workspace or selecting kind %s",
    async (kind) => {
      const { database, bindings, viewer, ids } = await createApiTestFixture();
      const original = await database
        .prepare("SELECT * FROM agent WHERE id = ?")
        .bind(ids.agentId)
        .first();
      const result = await withProviderProbeMock(() =>
        createAgentFork(bindings, viewer, {
          agentId: ids.agentId,
          projectId: ids.projectId,
          ...(kind === undefined ? {} : { kind }),
        }),
      );
      expect(result.agent.id).not.toBe(ids.agentId);
      expect(result.agent).not.toHaveProperty("kind");
      expect(
        await database.prepare("SELECT kind FROM agent WHERE id = ?").bind(result.agent.id).first(),
      ).toEqual({ kind: "cattle" });
      expect(result.agent.model).toBe(original?.["model"]);
      expect(result.agent.prompt).toBe(original?.["prompt"]);
      expect(
        await database.prepare("SELECT * FROM agent WHERE id = ?").bind(ids.agentId).first(),
      ).toEqual(original);
      expect(
        await database
          .prepare("SELECT COUNT(*) AS total FROM session WHERE agent_id = ?")
          .bind(result.agent.id)
          .first(),
      ).toEqual({ total: 0 });
    },
  );
});
