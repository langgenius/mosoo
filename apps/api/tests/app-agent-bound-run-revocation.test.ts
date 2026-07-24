import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, SessionId } from "@mosoo/id";
import { graphql } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import type { GraphQLContext } from "../src/adapters/graphql/graphql-context";
import { createDeploymentAgentCapabilityRunCreationGuard } from "../src/modules/apps/application/app-deployment-capability-authority.service";
import { getAccountViewer } from "../src/modules/auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";
import {
  queueSessionRun,
  SessionRunCreationGuardRejectedError,
} from "../src/modules/runtime/application/session-run.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const DEPLOYMENT_ID = "01J0000000000000000000000D";
const DEPLOYMENT_RUN_ID = "01J0000000000000000000000R";

const CLAIMS: AppAgentCapabilityClaims = {
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
};

async function insertDeploymentAuthority(database: SqliteD1Database): Promise<void> {
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
    .prepare("INSERT INTO app_deployment (app_id, deleted_at, id) VALUES (?, NULL, ?)")
    .bind(PUBLIC_API_TEST_IDS.app, DEPLOYMENT_ID)
    .run();
  await database
    .prepare(
      "INSERT INTO app_deployment_run (app_id, deployment_id, id, plan_json, status) VALUES (?, ?, ?, ?, 'success')",
    )
    .bind(
      PUBLIC_API_TEST_IDS.app,
      DEPLOYMENT_ID,
      DEPLOYMENT_RUN_ID,
      JSON.stringify({ agentBindings: [CLAIMS.binding] }),
    )
    .run();
}

function revokeDeploymentWhenRunInsertStarts(database: SqliteD1Database): D1Database {
  let revoked = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const shouldRevoke = /\bINSERT\s+INTO\s+(?:"session_run"|session_run)(?:\s|\()/iu.test(query);

    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }

        if (
          shouldRevoke &&
          !revoked &&
          (property === "all" || property === "first" || property === "raw" || property === "run")
        ) {
          const method = Reflect.get(target, property, receiver);

          if (typeof method === "function") {
            return async (...args: unknown[]) => {
              revoked = true;
              await database
                .prepare("UPDATE app_deployment SET deleted_at = ? WHERE id = ?")
                .bind(Date.now(), DEPLOYMENT_ID)
                .run();
              return method.apply(target, args);
            };
          }
        }

        return Reflect.get(target, property, receiver);
      },
    });
  }

  return {
    batch: database.batch.bind(database),
    prepare: (query) => wrapStatement(database.prepare(query), query),
  } as D1Database;
}

function queueBoundRun(input: { bindings: ApiBindings; viewer: AuthenticatedViewer }) {
  return queueSessionRun({
    bindings: input.bindings,
    executionContext: null,
    input: {
      accessViewer: input.viewer,
      attachmentIds: [],
      boundCapabilityProvenance: {
        agentId: CLAIMS.agentId,
        appId: CLAIMS.appId,
        bindingEnv: CLAIMS.binding.env,
        bindingName: CLAIMS.binding.name,
        deploymentId: CLAIMS.deploymentId,
        deploymentRunId: CLAIMS.deploymentRunId,
      },
      clientRequestId: null,
      prompt: "Race the deployment deletion.",
      runCreationGuard: createDeploymentAgentCapabilityRunCreationGuard(CLAIMS),
      session: {
        agent_id: CLAIMS.agentId,
        app_id: CLAIMS.appId,
        deployment_version_id: parsePlatformId<AgentDeploymentVersionId>(
          PUBLIC_API_TEST_IDS.deployment,
          "fixture deployment version",
        ),
        deployment_version_number: 1,
        id: parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "fixture session"),
        model: "gpt-5.4",
        provider: "openai",
        runtime_id: "openai-runtime",
      },
    },
    requestUrl: "https://api.example.com/api/v1/bound/test",
    viewer: input.viewer,
  });
}

function createBoundCapabilityAuditContext(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
): GraphQLContext {
  const executionCtx = createTestExecutionContext();

  return {
    bindings,
    executionContext: executionCtx,
    request: new Request("https://api.example.com/api/graphql"),
    serverContext: {
      ...bindings,
      executionCtx,
    },
    viewer,
  };
}

describe("bound Agent Run revocation boundary", () => {
  test("creates a Run while the claimed deployment authority remains current", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertDeploymentAuthority(database);
    const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

    if (viewer === null) {
      throw new Error("Owner test viewer is missing.");
    }

    const result = await queueBoundRun({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      viewer,
    });

    expect(result.run.status).toBe("queued");
    const response = await graphql({
      contextValue: createBoundCapabilityAuditContext(
        createPublicHttpTestBindings(database) as ApiBindings,
        viewer,
      ),
      schema: createGraphQLSchema(),
      source: `
        query BoundCapabilityRunAudit($appId: ULID!, $runId: ULID!) {
          boundCapabilityRunProvenance(appId: $appId, runId: $runId) {
            agentId
            appId
            bindingEnv
            bindingName
            deploymentId
            deploymentRunId
            runId
          }
        }
      `,
      variableValues: {
        appId: CLAIMS.appId,
        runId: result.run.id,
      },
    });

    expect(response).toEqual({
      data: {
        boundCapabilityRunProvenance: {
          agentId: CLAIMS.agentId,
          appId: CLAIMS.appId,
          bindingEnv: CLAIMS.binding.env,
          bindingName: CLAIMS.binding.name,
          deploymentId: CLAIMS.deploymentId,
          deploymentRunId: CLAIMS.deploymentRunId,
          runId: result.run.id,
        },
      },
    });
    await expect(
      database
        .prepare(
          `SELECT
            bound_capability_agent_id,
            bound_capability_app_id,
            bound_capability_binding_env,
            bound_capability_binding_name,
            bound_capability_deployment_id,
            bound_capability_deployment_run_id
          FROM session_run`,
        )
        .first(),
    ).resolves.toEqual({
      bound_capability_agent_id: CLAIMS.agentId,
      bound_capability_app_id: CLAIMS.appId,
      bound_capability_binding_env: CLAIMS.binding.env,
      bound_capability_binding_name: CLAIMS.binding.name,
      bound_capability_deployment_id: CLAIMS.deploymentId,
      bound_capability_deployment_run_id: CLAIMS.deploymentRunId,
    });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM session_run").first<{ count: number }>(),
    ).resolves.toEqual({ count: 1 });
  });

  test("does not expose accepted Run provenance to a non-owner", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertDeploymentAuthority(database);
    const owner = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);
    const nonOwner = await getAccountViewer(database, PUBLIC_API_TEST_IDS.nonOwnerAccount);

    if (owner === null || nonOwner === null) {
      throw new Error("Test viewers are missing.");
    }

    const result = await queueBoundRun({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      viewer: owner,
    });

    const response = await graphql({
      contextValue: createBoundCapabilityAuditContext(
        createPublicHttpTestBindings(database) as ApiBindings,
        nonOwner,
      ),
      schema: createGraphQLSchema(),
      source: `
        query BoundCapabilityRunAudit($appId: ULID!, $runId: ULID!) {
          boundCapabilityRunProvenance(appId: $appId, runId: $runId) {
            runId
          }
        }
      `,
      variableValues: {
        appId: CLAIMS.appId,
        runId: result.run.id,
      },
    });

    expect(response.data).toEqual({ boundCapabilityRunProvenance: null });
    expect(response.errors?.[0]?.extensions.code).toBe("FORBIDDEN");
  });

  test("returns no provenance for an existing non-bound Run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

    if (viewer === null) {
      throw new Error("Owner test viewer is missing.");
    }

    const result = await queueSessionRun({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      executionContext: null,
      input: {
        accessViewer: viewer,
        attachmentIds: [],
        clientRequestId: null,
        prompt: "Read a Run created before capability provenance.",
        session: {
          agent_id: CLAIMS.agentId,
          app_id: CLAIMS.appId,
          deployment_version_id: parsePlatformId<AgentDeploymentVersionId>(
            PUBLIC_API_TEST_IDS.deployment,
            "fixture deployment version",
          ),
          deployment_version_number: 1,
          id: parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "fixture session"),
          model: "gpt-5.4",
          provider: "openai",
          runtime_id: "openai-runtime",
        },
      },
      requestUrl: "https://api.example.com/api/graphql",
      viewer,
    });

    const response = await graphql({
      contextValue: createBoundCapabilityAuditContext(
        createPublicHttpTestBindings(database) as ApiBindings,
        viewer,
      ),
      schema: createGraphQLSchema(),
      source: `
        query BoundCapabilityRunAudit($appId: ULID!, $runId: ULID!) {
          boundCapabilityRunProvenance(appId: $appId, runId: $runId) {
            runId
          }
        }
      `,
      variableValues: {
        appId: CLAIMS.appId,
        runId: result.run.id,
      },
    });

    expect(response).toEqual({
      data: {
        boundCapabilityRunProvenance: null,
      },
    });
  });

  test("does not insert a Run when deletion commits after preflight authorization", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertDeploymentAuthority(database);
    const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

    if (viewer === null) {
      throw new Error("Owner test viewer is missing.");
    }

    const bindings = createPublicHttpTestBindings(
      revokeDeploymentWhenRunInsertStarts(database),
    ) as ApiBindings;

    await expect(queueBoundRun({ bindings, viewer })).rejects.toBeInstanceOf(
      SessionRunCreationGuardRejectedError,
    );

    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM session_run").first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });
});
