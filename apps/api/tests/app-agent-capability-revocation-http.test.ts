import { describe, expect, test } from "bun:test";

import { Hono } from "hono";

import { registerPublicApiRoute } from "../src/adapters/http/routes/public-api-route";
import { mintAppAgentCapabilityToken } from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const DEPLOYMENT_ID = "01J0000000000000000000000D";
const DEPLOYMENT_RUN_ID = "01J0000000000000000000000R";

function createBoundAgentRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();

  registerPublicApiRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

function capabilityClaims(
  overrides: Partial<AppAgentCapabilityClaims> = {},
): AppAgentCapabilityClaims {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    appId: PUBLIC_API_TEST_IDS.app,
    binding: {
      env: "MOSOO_PUBLIC_AGENT",
      expose: "public_thread",
      name: "Public API Agent",
    },
    deploymentId: DEPLOYMENT_ID,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

async function insertDeploymentAuthority(
  database: SqliteD1Database,
  input: { agentBindings: unknown[]; deletedAt: number | null },
): Promise<void> {
  database.execute(`
      CREATE TABLE app_deployment (
        app_id text NOT NULL,
        deleted_at integer,
        id text PRIMARY KEY NOT NULL
      );

      CREATE TABLE app_deployment_run (
        app_id text NOT NULL,
        deployment_id text NOT NULL,
        id text PRIMARY KEY NOT NULL,
        plan_json text,
        status text NOT NULL
      );

      CREATE INDEX app_deployment_run_deployment_id_idx
        ON app_deployment_run (deployment_id, id);
    `);

  await database
    .prepare("INSERT INTO app_deployment (app_id, deleted_at, id) VALUES (?, ?, ?)")
    .bind(PUBLIC_API_TEST_IDS.app, input.deletedAt, DEPLOYMENT_ID)
    .run();
  await database
    .prepare(
      "INSERT INTO app_deployment_run (app_id, deployment_id, id, plan_json, status) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      PUBLIC_API_TEST_IDS.app,
      DEPLOYMENT_ID,
      DEPLOYMENT_RUN_ID,
      JSON.stringify({ agentBindings: input.agentBindings }),
      "success",
    )
    .run();
}

async function requestBoundAgent(
  database: SqliteD1Database,
  claims: AppAgentCapabilityClaims,
): Promise<Response> {
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const token = await mintAppAgentCapabilityToken(bindings.RUNTIME_ACTION_TOKEN_SECRET, claims);

  return createBoundAgentRouteTestApp().request(
    new Request(`https://api.example.com/api/v1/bound/${token}`, {
      body: JSON.stringify({ message: "Hello" }),
      method: "POST",
    }),
    undefined,
    bindings,
    createTestExecutionContext(),
  );
}

async function expectNoSessions(database: SqliteD1Database): Promise<void> {
  await expect(
    database.prepare("SELECT COUNT(*) AS count FROM session").first<{ count: number }>(),
  ).resolves.toEqual({ count: 0 });
}

describe("bound Agent capability revocation HTTP boundary", () => {
  test("rejects a deleted deployment capability before it can create a Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertDeploymentAuthority(database, {
      agentBindings: [capabilityClaims().binding],
      deletedAt: Date.now(),
    });
    const response = await requestBoundAgent(database, capabilityClaims());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "agent_not_published",
        message: "This capability is no longer authorized for the active deployment.",
      },
    });
    await expectNoSessions(database);
  });

  test("rejects an expired capability before reading deployment state", async () => {
    const database = await createPublicHttpContractDatabase();
    const response = await requestBoundAgent(database, capabilityClaims({ exp: Date.now() }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "unauthenticated",
        message: "The capability URL is invalid or has expired.",
      },
    });
    await expectNoSessions(database);
  });

  test("rejects an unpublished Agent before it can create a Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE agent SET status = 'draft' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.agent)
      .run();

    const response = await requestBoundAgent(database, capabilityClaims());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "agent_not_published",
        message: "This Agent is no longer published for bound calls.",
      },
    });
    await expectNoSessions(database);
  });

  test("rejects a capability whose current successful revision removed its binding", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertDeploymentAuthority(database, { agentBindings: [], deletedAt: null });

    const response = await requestBoundAgent(database, capabilityClaims());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "agent_not_published",
        message: "This capability is no longer authorized for the active deployment.",
      },
    });
    await expectNoSessions(database);
  });
});
