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
    environmentNetworkPolicy?: "full" | "limited";
  },
) {
  return computeAgentReadiness(database, PUBLIC_API_TEST_IDS.ownerAccount, {
    agentId: PUBLIC_API_TEST_IDS.agent,
    environment: { environmentId: input.environmentId },
    ...(input.environmentNetworkPolicy === undefined
      ? {}
      : { environmentNetworkPolicy: input.environmentNetworkPolicy }),
    kind: "pet",
    model: "gpt-5.4",
    projectId: PUBLIC_API_TEST_IDS.project,
    provider: "openai",
    runtimeId: "openai-runtime",
  });
}

function expectLimitedEnvironmentIssue(readiness: Awaited<ReturnType<typeof computeReadiness>>) {
  expect(readiness.ready).toBe(false);
  expect(readiness.issues).toContainEqual(
    expect.objectContaining({
      code: "agent.environment.network_policy_unsupported",
      severity: "error",
    }),
  );
}

describe("Agent Environment network readiness", () => {
  test("blocks an explicit Limited Environment for an Assistant Agent", async () => {
    const database = await createPublicHttpContractDatabase();
    await setCurrentEnvironmentPolicy(database, "limited");

    expectLimitedEnvironmentIssue(
      await computeReadiness(database, { environmentId: PUBLIC_API_TEST_IDS.environment }),
    );
  });

  test("resolves a null Environment id through the Project default", async () => {
    const database = await createPublicHttpContractDatabase();
    await setCurrentEnvironmentPolicy(database, "limited");

    expectLimitedEnvironmentIssue(await computeReadiness(database, { environmentId: null }));
  });

  test("uses the frozen session snapshot policy instead of the current revision", async () => {
    const database = await createPublicHttpContractDatabase();
    await setCurrentEnvironmentPolicy(database, "limited");

    const readiness = await computeReadiness(database, {
      environmentId: PUBLIC_API_TEST_IDS.environment,
      environmentNetworkPolicy: "full",
    });

    expect(readiness.issues).not.toContainEqual(
      expect.objectContaining({ code: "agent.environment.network_policy_unsupported" }),
    );
  });
});
