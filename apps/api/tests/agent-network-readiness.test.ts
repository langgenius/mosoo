import { describe, expect, test } from "bun:test";

import { computeAgentReadiness } from "../src/modules/agents/application/agent-readiness.service";
import {
  createPublicHttpContractDatabase,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

async function setCurrentEnvironmentPolicy(
  database: D1Database,
  networkPolicy: "full" | "limited",
): Promise<void> {
  await database
    .prepare("UPDATE environment_revision SET network_policy = ? WHERE id = ?")
    .bind(networkPolicy, PUBLIC_API_TEST_IDS.environmentRevision)
    .run();
}

async function computeReadiness(
  database: D1Database,
  input: {
    environmentId: string | null;
  },
) {
  return computeAgentReadiness(database, PUBLIC_API_TEST_IDS.ownerAccount, {
    agentId: PUBLIC_API_TEST_IDS.agent,
    builtInTools: [],
    environment: { environmentId: input.environmentId },
    model: "gpt-5.4",
    projectId: PUBLIC_API_TEST_IDS.project,
    provider: "openai",
    runtimeId: "openai-runtime",
  });
}

describe("Session preset network readiness", () => {
  test.each([PUBLIC_API_TEST_IDS.environment, null])(
    "accepts a Limited Environment without an Agent type restriction (%s)",
    async (environmentId) => {
      const database = await createPublicHttpContractDatabase();
      await setCurrentEnvironmentPolicy(database, "limited");
      const readiness = await computeReadiness(database, { environmentId });
      expect(readiness.ready).toBe(true);
      expect(readiness.issues).not.toContainEqual(
        expect.objectContaining({ code: "agent.environment.network_policy_unsupported" }),
      );
    },
  );
});
