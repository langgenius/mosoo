import { describe, expect, test } from "bun:test";

import { agentsTable } from "@mosoo/db";

import {
  publishAgent,
  updateAgentConfig,
} from "../src/modules/agents/application/agent-command.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

const DRAFT_AGENT_ID = "01J0000000000000000000000G";
const INITIAL_CONFIG_JSON = JSON.stringify({
  packageMcpServers: [],
  packageResolution: null,
  packageSkills: [],
});

async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [{ id: "gpt-5.4" }],
    });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("agent deployment version atomicity", () => {
  test("publish writes status, ACL, deployment version, and live pointer together", async () => {
    const database = await createPublicHttpContractDatabase();
    const nowMs = nowMsForTest();

    await database
      .app()
      .insert(agentsTable)
      .values({
        configJson: INITIAL_CONFIG_JSON,
        createdAt: nowMs,
        description: null,
        environmentId: PUBLIC_API_TEST_IDS.environment,
        id: DRAFT_AGENT_ID,
        kind: "pet",
        liveDeploymentVersionId: null,
        model: "gpt-5.4",
        name: "Draft Agent",
        ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
        appId: PUBLIC_API_TEST_IDS.app,
        prompt: "Draft help.",
        provider: "openai",
        runtimeId: "openai-runtime",
        status: "draft",
        updatedAt: nowMs,
        visibility: "private",
      })
      .run();

    const published = await withProviderProbeMock(() =>
      publishAgent(createPublicHttpTestBindings(database) as ApiBindings, OWNER_VIEWER, {
        agentId: DRAFT_AGENT_ID,
        appId: PUBLIC_API_TEST_IDS.app,
        visibility: "private",
      }),
    );

    const row = await database
      .prepare(
        `
          SELECT agent.live_deployment_version_id,
                 agent.status,
                 agent.visibility,
                 version.prompt,
                 version.version_number
          FROM agent
          INNER JOIN agent_deployment_version version
            ON version.id = agent.live_deployment_version_id
          WHERE agent.id = ?
        `,
      )
      .bind(DRAFT_AGENT_ID)
      .first<{
        live_deployment_version_id: string;
        prompt: string;
        status: string;
        version_number: number;
        visibility: string;
      }>();

    expect(published).toMatchObject({
      id: DRAFT_AGENT_ID,
      status: "published",
      visibility: "private",
    });
    expect(published.liveVersion).toMatchObject({
      agentId: DRAFT_AGENT_ID,
      isLive: true,
      versionNumber: 1,
    });
    expect(row).toMatchObject({
      prompt: "Draft help.",
      status: "published",
      version_number: 1,
      visibility: "private",
    });
    expect(row?.live_deployment_version_id).toBe(published.liveVersion?.id);
  });

  test("published config save writes the new live version in the same profile mutation", async () => {
    const database = await createPublicHttpContractDatabase();

    const updated = await updateAgentConfig(database, OWNER_VIEWER, {
      agentId: PUBLIC_API_TEST_IDS.agent,
      description: null,
      environment: {
        boundSpaceIds: [],
        environmentId: PUBLIC_API_TEST_IDS.environment,
      },
      kind: "pet",
      mcpServerIds: [],
      model: "gpt-5.4",
      name: "Public API Agent",
      prompt: "Help more.",
      appId: PUBLIC_API_TEST_IDS.app,
      provider: "openai",
      runtimeId: "openai-runtime",
      skillIds: [],
    });

    const rows = await database
      .prepare(
        `
          SELECT agent.live_deployment_version_id,
                 version.prompt,
                 version.version_number
          FROM agent
          INNER JOIN agent_deployment_version version
            ON version.id = agent.live_deployment_version_id
          WHERE agent.id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.agent)
      .first<{
        live_deployment_version_id: string;
        prompt: string;
        version_number: number;
      }>();
    const versionCount = await database
      .prepare("SELECT COUNT(*) AS count FROM agent_deployment_version WHERE agent_id = ?")
      .bind(PUBLIC_API_TEST_IDS.agent)
      .first<{ count: number }>();

    expect(updated.liveVersion).toMatchObject({
      id: rows?.live_deployment_version_id,
      versionNumber: 2,
    });
    expect(rows).toEqual({
      live_deployment_version_id: updated.liveVersion?.id,
      prompt: "Help more.",
      version_number: 2,
    });
    expect(versionCount?.count).toBe(2);
  });
});
