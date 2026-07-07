import { describe, expect, test } from "bun:test";

import { parseNativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";
import { NATIVE_REPO_MULTI_AGENT_FILES } from "@mosoo/contracts/native-repo-fixtures";
import type { AppDeploymentRunRow } from "@mosoo/db";
import { agentsTable, appDeploymentRunsTable, vendorCredentialsTable } from "@mosoo/db";
import type { AppId, VendorCredentialId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { AppDeploymentBuildRunner } from "../src/modules/apps/application/app-deployment-executor.service";
import { dispatchAppDeploymentRun } from "../src/modules/apps/application/app-deployment-executor.service";
import { deployApp } from "../src/modules/apps/application/app-deployment.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { storeVendorCredentialSecret } from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  TOKENS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";
import {
  bearer,
  createPublicThreadApiTestApp,
  expectArray,
  expectRecord,
  expectString,
  insertRuntimeEvent,
  readJson,
  requestPublicApi,
  withProviderProbeMock,
} from "./public-thread-api-fixtures";

const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const ANTHROPIC_VENDOR_CREDENTIAL_ID = "vendor-anthropic-app" as VendorCredentialId;
const GREEN_MULTI_AGENT_FILES = Object.freeze(NATIVE_REPO_MULTI_AGENT_FILES);
const REPO_DEFINED_AGENT_NAMES = ["concierge", "support", "triage"] as const;
const EXPOSED_AGENT_NAMES = ["concierge", "support"] as const;

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Owner",
};

const githubFetch: typeof fetch = async (input) => {
  const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;

  if (url === "https://api.github.com/repos/samzong/awire") {
    return Response.json({
      clone_url: "https://github.com/samzong/awire.git",
      default_branch: "main",
      name: "awire",
      owner: { login: "samzong" },
      private: false,
    });
  }

  if (url === "https://api.github.com/repos/samzong/awire/branches/main") {
    return Response.json({
      commit: { sha: "abc123" },
    });
  }

  return new Response("not found", { status: 404 });
};

interface NativeDeployInstance {
  bindings: ApiBindings;
  database: SqliteD1Database;
}

interface FakeRunnerState {
  buildCount: number;
  deployCount: number;
}

interface AgentDeploymentAssertionRow {
  exposed_via_api: number | null;
  live_deployment_version_id: string | null;
  name: string;
  status: string;
  version_number: number | null;
}

function createFakeRunner(files: Readonly<Record<string, string>>) {
  const state: FakeRunnerState = {
    buildCount: 0,
    deployCount: 0,
  };
  const runner: AppDeploymentBuildRunner = {
    async build() {
      state.buildCount += 1;
    },
    async deploy() {
      state.deployCount += 1;
      return {
        externalDeploymentId: "external-deploy-1",
        externalProjectId: null,
        externalVersionId: "external-version-1",
        url: "https://deployed.example",
      };
    },
    async prepare() {
      return { repoDir: "/repo", snapshot: { files } };
    },
  };

  return { runner, state };
}

async function createNativeDeployInstance(): Promise<NativeDeployInstance> {
  const database = await createPublicHttpContractDatabase();

  database.execute(`
    CREATE TABLE app_deployment (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      default_branch text NOT NULL,
      deleted_at integer,
      id text PRIMARY KEY NOT NULL,
      last_successful_url text,
      latest_run_id text,
      mosoo_subdomain text NOT NULL,
      owner_account_id text NOT NULL,
      repo_name text NOT NULL,
      repo_owner text NOT NULL,
      repo_url text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX app_deployment_active_app_idx
      ON app_deployment (app_id)
      WHERE deleted_at IS NULL;

    CREATE TABLE app_deployment_run (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      deployment_id text NOT NULL,
      error_code text,
      error_message text,
      external_deployment_id text,
      external_project_id text,
      external_version_id text,
      generated_wrangler_config_json text,
      id text PRIMARY KEY NOT NULL,
      mosoo_config_json text,
      native_result_json text,
      plan_json text,
      source_branch text NOT NULL,
      source_commit_sha text NOT NULL,
      status text NOT NULL,
      target_kind text,
      target_project_name text,
      target_script_name text,
      updated_at integer NOT NULL,
      url text
    );

    CREATE UNIQUE INDEX app_deployment_run_active_app_idx
      ON app_deployment_run (app_id)
      WHERE status IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating');

    CREATE TABLE IF NOT EXISTS skill_snapshot (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE UNIQUE INDEX IF NOT EXISTS skill_snapshot_blob_sha256_idx
      ON skill_snapshot (app_id, blob_sha256);

    CREATE TABLE IF NOT EXISTS skill_snapshot_entry (
      entry_kind text NOT NULL,
      is_executable integer NOT NULL,
      mime_type text,
      path text NOT NULL,
      sha256 text,
      size integer NOT NULL,
      snapshot_id text NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    );
  `);

  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: new PublicApiMemoryFileBucket() as unknown as R2Bucket,
  }) as ApiBindings;

  await seedAnthropicVendorCredential(bindings, database);

  return { bindings, database };
}

async function seedAnthropicVendorCredential(
  bindings: ApiBindings,
  database: SqliteD1Database,
): Promise<void> {
  const apiKeySecretId = await storeVendorCredentialSecret(bindings, {
    apiKey: "sk-ant-test",
    credentialId: ANTHROPIC_VENDOR_CREDENTIAL_ID,
    appId: APP_ID,
    providerId: "anthropic",
    purpose: "credential_create_api_key",
  });

  await database
    .app()
    .insert(vendorCredentialsTable)
    .values({
      apiBase: null,
      apiKeySecretId,
      createdAt: nowMsForTest(),
      id: ANTHROPIC_VENDOR_CREDENTIAL_ID,
      models: null,
      name: "App Anthropic",
      appId: APP_ID,
      updatedAt: nowMsForTest(),
      vendorId: "anthropic",
    })
    .run();
}

async function removeSeededAgents(database: SqliteD1Database): Promise<void> {
  await database
    .prepare("DELETE FROM agent_deployment_version WHERE agent_id IN (SELECT id FROM agent)")
    .run();
  await database.prepare("DELETE FROM agent").run();
}

async function seedCollidingConcierge(database: SqliteD1Database): Promise<void> {
  await database
    .app()
    .insert(agentsTable)
    .values({
      appId: APP_ID,
      configJson: JSON.stringify({
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
      }),
      createdAt: nowMsForTest(),
      description: null,
      environmentId: null,
      exposedViaApi: null,
      id: "01J000000000000000000000G7",
      kind: "pet",
      liveDeploymentVersionId: null,
      model: "claude-sonnet-4-5",
      name: "concierge",
      ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
      prompt: "Legacy concierge prompt.",
      provider: "anthropic",
      runtimeId: "claude-agent-sdk",
      status: "draft",
      updatedAt: nowMsForTest(),
      visibility: "private",
    })
    .run();
}

async function createInstanceA(): Promise<NativeDeployInstance> {
  const instance = await createNativeDeployInstance();

  await removeSeededAgents(instance.database);
  await seedCollidingConcierge(instance.database);

  return instance;
}

async function createInstanceB(): Promise<NativeDeployInstance> {
  const instance = await createNativeDeployInstance();

  await removeSeededAgents(instance.database);

  return instance;
}

async function countAgents(database: SqliteD1Database): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS count FROM agent WHERE app_id = ?")
    .bind(APP_ID)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function dispatchRepo(instance: NativeDeployInstance): Promise<{
  runRow: AppDeploymentRunRow;
  state: FakeRunnerState;
}> {
  const run = await deployApp(
    instance.bindings,
    OWNER_VIEWER,
    { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
    { fetch: githubFetch, nowMs: nowMsForTest },
  );
  const { runner, state } = createFakeRunner(GREEN_MULTI_AGENT_FILES);

  await withProviderProbeMock(() =>
    dispatchAppDeploymentRun(instance.bindings, { appDeploymentRunId: run.id }, { runner }),
  );

  const runRow = await instance.database
    .app()
    .select()
    .from(appDeploymentRunsTable)
    .where(eq(appDeploymentRunsTable.id, run.id))
    .limit(1)
    .get();

  if (runRow === undefined) {
    throw new Error("Deployment run row missing after dispatch.");
  }

  return { runRow, state };
}

async function readAppSlug(database: SqliteD1Database): Promise<string | null> {
  const row = await database
    .prepare("SELECT slug FROM app WHERE id = ?")
    .bind(APP_ID)
    .first<{ slug: string | null }>();

  return row?.slug ?? null;
}

async function readAgentDeploymentRows(
  database: SqliteD1Database,
): Promise<AgentDeploymentAssertionRow[]> {
  return (
    await database
      .prepare(
        `
          SELECT agent.name,
                 agent.exposed_via_api,
                 agent.live_deployment_version_id,
                 agent.status,
                 version.version_number
            FROM agent
            LEFT JOIN agent_deployment_version AS version
              ON version.id = agent.live_deployment_version_id
           WHERE agent.app_id = ?
           ORDER BY agent.name
        `,
      )
      .bind(APP_ID)
      .all<AgentDeploymentAssertionRow>()
  ).results;
}

function assertGreenNativeDeployment(input: {
  expectedActions: Record<(typeof REPO_DEFINED_AGENT_NAMES)[number], "created" | "existing">;
  runRow: AppDeploymentRunRow;
  state: FakeRunnerState;
}): void {
  expect(input.runRow).toMatchObject({
    errorCode: null,
    status: "success",
    targetKind: null,
    url: null,
  });
  expect(input.runRow.errorCode).not.toBe("deployment_agent_not_found");
  expect(input.state.buildCount).toBe(0);
  expect(input.state.deployCount).toBe(0);

  const native = parseNativeDeploymentRunResult(input.runRow.nativeResultJson);

  expect(native?.facts?.agentCount).toBe(3);
  expect(native?.facts?.specVersion).toBe("mosoo.spec.v1");
  expect(native?.facts?.web).toEqual({ declared: false });
  expect(native?.facts?.agents.map((agent) => agent.name)).toEqual(REPO_DEFINED_AGENT_NAMES);
  expect(native?.facts?.agents.map((agent) => agent.exposed)).toEqual([true, true, false]);
  expect(native?.validate.valid).toBe(true);

  const facts = native?.facts?.agents ?? [];

  for (const name of REPO_DEFINED_AGENT_NAMES) {
    const fact = facts.find((agent) => agent.name === name);

    expect(fact).not.toBeUndefined();

    if (input.expectedActions[name] === "created") {
      expect(fact?.action).toBe("created");
      expect(fact?.versionNumber).toBe(1);
    } else {
      expect(["updated", "unchanged"]).toContain(fact?.action);
      if (fact?.action === "updated") {
        expect(fact.versionNumber).toBeNumber();
      }
    }
  }
}

async function assertPublishedRepoAgents(database: SqliteD1Database): Promise<void> {
  const rows = await readAgentDeploymentRows(database);

  expect(rows.map((row) => row.name)).toEqual(REPO_DEFINED_AGENT_NAMES);

  for (const row of rows) {
    expect(row.status).toBe("published");
    expect(row.live_deployment_version_id).toBeString();
    expect(row.version_number).toBeNumber();
    expect(row.exposed_via_api).toBe(EXPOSED_AGENT_NAMES.includes(row.name) ? 1 : 0);
  }

  expect(await readAppSlug(database)).toBe("default-app");
}

async function proveNameAddressedAgentAnswers(database: SqliteD1Database): Promise<void> {
  const app = createPublicThreadApiTestApp();
  const slug = await readAppSlug(database);

  expect(slug).toBe("default-app");

  const threadsUrl = `https://api.example.com/api/v1/apps/${slug}/agents/concierge/threads`;

  const createResponse = await withProviderProbeMock(() =>
    requestPublicApi(
      app,
      database,
      new Request(threadsUrl, {
        body: JSON.stringify({
          client_external_ref: "native-portability-1",
          input: {
            content: [{ text: "Say hello from native deploy.", type: "text" }],
            type: "user.message",
          },
        }),
        headers: {
          Authorization: bearer(TOKENS.owner),
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    ),
  );

  expect(createResponse.status).toBe(201);
  const createBody = await readJson(createResponse);
  const thread = expectRecord(createBody["thread"]);
  const run = expectRecord(createBody["run"]);
  const threadId = expectString(thread["id"]);
  const runId = expectString(run["id"]);

  await database.prepare("DELETE FROM session_event WHERE session_id = ?").bind(threadId).run();

  await insertRuntimeEvent(database, {
    kind: "run.started",
    occurredAt: 1_000,
    payload: {
      startedAt: "1970-01-01T00:00:01.000Z",
    },
    runId,
    seq: 1,
    sessionId: threadId,
  });
  await insertRuntimeEvent(database, {
    kind: "message.added",
    occurredAt: 1_050,
    payload: {
      content: "Hello from native portability",
      messageId: "assistant-1",
      role: "agent",
    },
    runId,
    seq: 2,
    sessionId: threadId,
  });
  await insertRuntimeEvent(database, {
    kind: "run.completed",
    occurredAt: 1_150,
    payload: { stopReason: "end_turn" },
    runId,
    seq: 3,
    sessionId: threadId,
  });

  const eventsResponse = await requestPublicApi(
    app,
    database,
    new Request(`https://api.example.com/api/v1/threads/${threadId}/events`, {
      headers: { Authorization: bearer(TOKENS.owner) },
    }),
  );

  expect(eventsResponse.status).toBe(200);
  const events = expectArray((await readJson(eventsResponse))["events"]);

  expect(events.map((event) => expectRecord(event)["content"])).toContain(
    "Hello from native portability",
  );
}

describe("native deployment portability", () => {
  test("the same green multi-agent repo deploys on two fresh instances", async () => {
    const instanceA = await createInstanceA();
    const instanceB = await createInstanceB();

    expect(await countAgents(instanceA.database)).toBe(1);
    expect(await countAgents(instanceB.database)).toBe(0);

    const deployedA = await dispatchRepo(instanceA);
    const deployedB = await dispatchRepo(instanceB);

    assertGreenNativeDeployment({
      expectedActions: {
        concierge: "existing",
        support: "created",
        triage: "created",
      },
      runRow: deployedA.runRow,
      state: deployedA.state,
    });
    assertGreenNativeDeployment({
      expectedActions: {
        concierge: "created",
        support: "created",
        triage: "created",
      },
      runRow: deployedB.runRow,
      state: deployedB.state,
    });

    await assertPublishedRepoAgents(instanceA.database);
    await assertPublishedRepoAgents(instanceB.database);

    expect(await countAgents(instanceB.database)).toBe(3);

    await proveNameAddressedAgentAnswers(instanceB.database);
  });
});
