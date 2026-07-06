import { describe, expect, mock, test } from "bun:test";

import type { SandboxSessionId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import type { DriverProfileConfig } from "../src/modules/runtime/domain/driver-snapshot";
import type {
  ExecutionSessionHandle,
  RuntimeProcessHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    throw new Error("getSandbox is not used in driver session readiness tests.");
  },
}));

type ProvisionSessionDriverInput = {
  driverInstanceId: string;
  profile: DriverProfileConfig;
  sandboxSessionId: string;
};

type ProvisionSessionDriverResult = {
  driverInstanceId: string;
  process: RuntimeProcessHandle;
  sandboxId: string;
  timing: { phases: [] };
};

type ProvisionSessionDriverMock = (
  bindings: ApiBindings,
  input: ProvisionSessionDriverInput,
) => Promise<ProvisionSessionDriverResult>;

class DriverPrewarmProvisionSkippedError extends Error {}

let provisionSessionDriverMock: ProvisionSessionDriverMock = async () => {
  throw new Error("provisionSessionDriver mock was not configured.");
};

mock.module("../src/modules/runtime/infrastructure/runtime-sandbox-provisioner", () => ({
  DriverPrewarmProvisionSkippedError,
  provisionSessionDriver: (bindings: ApiBindings, input: ProvisionSessionDriverInput) =>
    provisionSessionDriverMock(bindings, input),
}));

const { dispatchDriverTurn, ensureDriverSessionReady } =
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
      command_seq_cursor integer DEFAULT 0 NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE driver_command (
      acked_at integer,
      completed_at integer,
      delivery_connection_id text,
      driver_instance_id text NOT NULL,
      error_json text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      issued_at integer NOT NULL,
      kind text NOT NULL,
      payload_json text NOT NULL,
      result_json text,
      seq integer NOT NULL,
      status text NOT NULL
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

function createHangingProcess(): RuntimeProcessHandle {
  return {
    getLogs: async () => "",
    getStatus: async () => "running",
    id: "process-1",
    kill: async () => {},
    pid: 123,
    waitForExit: async () => new Promise(() => undefined),
    waitForPort: async () => {},
  };
}

function createFailingDriverConnectionBinding(
  requests: { count: number },
  onFetch?: () => Promise<void>,
) {
  return {
    get: () => ({
      fetch: async () => {
        requests.count += 1;
        await onFetch?.();
        return Response.json({ error: "driver readiness unavailable" }, { status: 500 });
      },
    }),
    idFromName: (name: string) => name,
  };
}

function createBindings(
  database: D1Database,
  requests: { count: number },
  onFetch?: () => Promise<void>,
): ApiBindings {
  return {
    DB: database,
    DriverConnection: createFailingDriverConnectionBinding(
      requests,
      onFetch,
    ) as ApiBindings["DriverConnection"],
  } as ApiBindings;
}

describe("driver session readiness", () => {
  test("returns a provisioning run lease before waiting for ready", async () => {
    const database = createDriverSessionDatabase();
    const requests = { count: 0 };
    const bindings = createBindings(database, requests);

    const driver = await ensureDriverSessionReady(bindings, "https://api.test/runtime", {
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
    });

    const linkedRun = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();

    expect(requests.count).toBe(0);
    expect(linkedRun).toEqual({ driver_instance_id: DRIVER_INSTANCE_ID });
    await expect(driver.readiness()).rejects.toThrow();

    const run = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();

    expect(requests.count).toBeGreaterThan(0);
    expect(run).toEqual({ driver_instance_id: null });
  });

  test("links a newly provisioned driver before readiness waits", async () => {
    const database = createDriverSessionDatabase();
    const requests = { count: 0 };
    const observed = { linkedBeforeReadyWait: false };

    await database.prepare("DELETE FROM driver_instance").run();

    provisionSessionDriverMock = async (bindings, input) => {
      await bindings.DB.prepare(
        `
          INSERT INTO driver_instance (
            id,
            sandbox_id,
            sandbox_session_id,
            status,
            updated_at
          )
          VALUES (?, ?, ?, 'connecting', 2)
        `,
      )
        .bind(input.driverInstanceId, input.profile.sandbox.id, input.sandboxSessionId)
        .run();

      return {
        driverInstanceId: input.driverInstanceId,
        process: createHangingProcess(),
        sandboxId: input.profile.sandbox.id,
        timing: { phases: [] },
      };
    };

    const bindings = createBindings(database, requests, async () => {
      const run = await database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(SESSION_RUN_ID)
        .first<{ driver_instance_id: string | null }>();

      observed.linkedBeforeReadyWait = run?.driver_instance_id !== null;
    });

    const driver = await ensureDriverSessionReady(bindings, "https://api.test/runtime", {
      cloudflareSession: {} as ExecutionSessionHandle,
      profile: PROFILE,
      resolvedMcpServers: [],
      resolvedSkillCatalog: [],
      resolvedSkills: [],
      sandbox: {} as SandboxHandle,
      sandboxSessionId: SESSION_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "trace-new-provision-ready-wait",
    });

    const linkedRun = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();

    expect(requests.count).toBe(0);
    expect(linkedRun?.driver_instance_id).toBe(driver.driverInstanceId);
    await expect(driver.readiness()).rejects.toThrow();

    const run = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .first<{ driver_instance_id: string | null }>();

    expect(requests.count).toBeGreaterThan(0);
    expect(observed.linkedBeforeReadyWait).toBe(true);
    expect(run).toEqual({ driver_instance_id: null });
  });

  test("persists input before readiness completes", async () => {
    const database = createDriverSessionDatabase();
    const requests = { count: 0 };
    const bindings = createBindings(database, requests);
    const driver = await ensureDriverSessionReady(bindings, "https://api.test/runtime", {
      cloudflareSession: {} as ExecutionSessionHandle,
      profile: PROFILE,
      resolvedMcpServers: [],
      resolvedSkillCatalog: [],
      resolvedSkills: [],
      sandbox: {} as SandboxHandle,
      sandboxSessionId: SESSION_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "trace-input-before-ready",
    });

    await dispatchDriverTurn(bindings, {
      attachmentIds: [],
      driverInstanceId: driver.driverInstanceId,
      prompt: "hello",
      sessionRunId: SESSION_RUN_ID,
    });

    const command = await database
      .prepare(
        `
          SELECT kind, payload_json, status
          FROM driver_command
          WHERE driver_instance_id = ?
        `,
      )
      .bind(driver.driverInstanceId)
      .first<{ kind: string; payload_json: string; status: string }>();

    expect(requests.count).toBe(0);
    expect(command?.kind).toBe("input.start");
    expect(command?.status).toBe("queued");
    expect(JSON.parse(command?.payload_json ?? "{}")).toMatchObject({
      input: { text: "hello" },
      kind: "input.start",
      runId: SESSION_RUN_ID,
    });
    await expect(driver.readiness()).rejects.toThrow();
  });
});
