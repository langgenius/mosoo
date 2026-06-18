import { describe, expect, mock, test } from "bun:test";

import type { SandboxSessionId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import type { DriverProfileConfig } from "../src/modules/runtime/domain/driver-snapshot";
import type {
  ExecutionSessionHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    throw new Error("getSandbox is not used in driver session readiness tests.");
  },
}));

const { ensureDriverSessionReady } =
  await import("../src/modules/runtime/infrastructure/driver-session.service");

const ACCOUNT_ID = PLATFORM_ID_FIXTURES.account;
const AGENT_ID = PLATFORM_ID_FIXTURES.agent;
const DRIVER_INSTANCE_ID = PLATFORM_ID_FIXTURES.driverInstance;
const ENVIRONMENT_ID = PLATFORM_ID_FIXTURES.environment;
const ENVIRONMENT_REVISION_ID = PLATFORM_ID_FIXTURES.environmentRevision;
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;
const SESSION_ID = PLATFORM_ID_FIXTURES.session;
const SESSION_RUN_ID = PLATFORM_ID_FIXTURES.sessionRun;
const SANDBOX_SESSION_ID = SESSION_ID as unknown as SandboxSessionId;

const PROFILE: DriverProfileConfig = {
  agentId: AGENT_ID,
  configRevision: {
    agentId: AGENT_ID,
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    environmentId: ENVIRONMENT_ID,
    environmentRevisionId: ENVIRONMENT_REVISION_ID,
    runId: SESSION_RUN_ID,
    sessionId: SESSION_ID,
  },
  envVarNames: [],
  envVars: {},
  kind: "pet",
  model: "gpt-5.4",
  prompt: "Help.",
  provider: "openai",
  providerOptions: {},
  readiness: {
    checkedAt: "2026-05-08T00:00:00.000Z",
    issues: [],
    ready: true,
  },
  runtimeId: "openai-runtime",
  sandbox: {
    id: SANDBOX_ID,
    kind: "pet",
    subjectId: AGENT_ID,
    subjectKind: "agent",
  },
  session: {
    sandboxSessionId: SANDBOX_SESSION_ID,
    homePath: "/workspace",
    origin: {
      callerUserId: ACCOUNT_ID,
      entrypoint: "api",
      executionOwnerUserId: ACCOUNT_ID,
      type: "agent",
    },
    sessionOrganizationPath: `/workspace/sessions/${SESSION_ID}`,
  },
  setupScript: "",
  sourceKind: "agent",
};

function createDriverSessionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL,
      status_seq integer NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO sandbox (id, inactive_deadline_at, kind, updated_at)
    VALUES ('${SANDBOX_ID}', 1, 'pet', 1);

    INSERT INTO sandbox_session (sandbox_id, session_id, status)
    VALUES ('${SANDBOX_ID}', '${SESSION_ID}', 'active');

    INSERT INTO driver_instance (
      id,
      sandbox_id,
      sandbox_session_id,
      status,
      updated_at
    )
    VALUES ('${DRIVER_INSTANCE_ID}', '${SANDBOX_ID}', '${SESSION_ID}', 'provisioning', 1);

    INSERT INTO session_run (id, session_id, status, status_seq, updated_at)
    VALUES ('${SESSION_RUN_ID}', '${SESSION_ID}', 'running', 0, 1);
  `);

  return database;
}

function createFailingDriverConnectionBinding(requests: { count: number }) {
  return {
    get: () => ({
      fetch: async () => {
        requests.count += 1;
        return Response.json({ error: "driver readiness unavailable" }, { status: 500 });
      },
    }),
    idFromName: (name: string) => name,
  };
}

function createBindings(database: D1Database, requests: { count: number }): ApiBindings {
  return {
    DB: database,
    DriverConnection: createFailingDriverConnectionBinding(
      requests,
    ) as ApiBindings["DriverConnection"],
  } as ApiBindings;
}

describe("driver session readiness", () => {
  test("releases a provisioning run lease when prepare waits fail", async () => {
    const database = createDriverSessionDatabase();
    const requests = { count: 0 };
    const bindings = createBindings(database, requests);

    await expect(
      ensureDriverSessionReady(bindings, "https://api.test/runtime", {
        cloudflareSession: {} as ExecutionSessionHandle,
        profile: PROFILE,
        resolvedMcpServers: [],
        resolvedSkillCatalog: [],
        resolvedSkills: [],
        sandbox: {} as SandboxHandle,
        sandboxSessionId: SESSION_ID,
        sessionId: SESSION_ID,
        sessionRunId: SESSION_RUN_ID,
        traceId: "trace-prepare-failure",
      }),
    ).rejects.toThrow();

    const run = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();

    expect(requests.count).toBeGreaterThan(0);
    expect(run).toEqual({ driver_instance_id: null });
  });
});
