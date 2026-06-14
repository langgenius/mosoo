import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createAgentSession } from "../src/modules/runtime/application/session-run.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

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

async function withProviderProbeFailure<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("createAgentSession", () => {
  test("returns the created Session summary", async () => {
    const database = await createPublicHttpContractDatabase();

    const session = await withProviderProbeMock(() =>
      createAgentSession({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          type: "preview",
        },
        viewer: OWNER_VIEWER,
      }),
    );

    expect(session).toMatchObject({
      agentId: PUBLIC_API_TEST_IDS.agent,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      kind: "pet",
      lastRun: null,
      model: "gpt-5.4",
      organizationId: PUBLIC_API_TEST_IDS.organization,
      provider: "openai",
      appId: PUBLIC_API_TEST_IDS.app,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: null,
      type: "preview",
    });
    expect(session.id).toBeString();
    expect(session.createdAt).toBe(session.updatedAt);
  });

  test("fails Public Thread session creation when the live version is missing", async () => {
    const database = await createPublicHttpContractDatabase();
    database.execute("PRAGMA ignore_check_constraints = ON");
    await database
      .prepare("UPDATE agent SET live_deployment_version_id = NULL WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.agent)
      .run();
    database.execute("PRAGMA ignore_check_constraints = OFF");

    await expect(
      createAgentSession({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          appId: PUBLIC_API_TEST_IDS.app,
          type: "preview",
        },
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_LIVE_VERSION_REQUIRED",
      status: 409,
    });

    const sessionCount = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    const versionCount = await database
      .prepare("SELECT COUNT(*) AS count FROM agent_deployment_version")
      .first<{ count: number }>();
    expect(sessionCount?.count).toBe(0);
    expect(versionCount?.count).toBe(1);
  });

  test.each(["ui", "api_channel"] as const)(
    "rejects runtime readiness wait for %s session creation",
    async (type) => {
      const database = await createPublicHttpContractDatabase();

      await expect(
        withProviderProbeMock(() =>
          createAgentSession({
            bindings: createPublicHttpTestBindings(database) as ApiBindings,
            input: {
              agentId: PUBLIC_API_TEST_IDS.agent,
              appId: PUBLIC_API_TEST_IDS.app,
              type,
              waitForRuntimeReady: true,
            },
            requestUrl: "https://api.example.com/graphql",
            viewer: OWNER_VIEWER,
          }),
        ),
      ).rejects.toMatchObject({
        code: "RUNTIME_READY_WAIT_UNSUPPORTED",
        status: 400,
      });

      const row = await database
        .prepare('SELECT COUNT(*) AS count FROM "session"')
        .first<{ count: number }>();
      expect(row?.count).toBe(0);
    },
  );

  test("returns a validation error when readiness blocks session creation", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      withProviderProbeFailure(() =>
        createAgentSession({
          bindings: createPublicHttpTestBindings(database) as ApiBindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            appId: PUBLIC_API_TEST_IDS.app,
            type: "preview",
          },
          viewer: OWNER_VIEWER,
        }),
      ),
    ).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_READY",
      status: 400,
    });

    const row = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
