import { describe, expect, test } from "bun:test";

import { apiCommandsTable, appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { createAppDeploymentRunDispatchDedupeKey } from "../src/modules/api-command/application/api-command-enqueue";
import { processApiCommandDeadLetterMessage } from "../src/modules/api-command/application/api-command-processor";
import type { CloudflareDeploymentClient } from "../src/modules/apps/application/app-deployment-cloudflare-client";
import {
  dispatchAppDeploymentRun,
  type AppDeploymentBuildRunner,
} from "../src/modules/apps/application/app-deployment-executor.service";
import {
  deleteAppDeployment,
  deployApp,
  getAppDeployment,
  getAppDeploymentStatus,
} from "../src/modules/apps/application/app-deployment.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { currentTimestampMs } from "../src/time";
import {
  createApiCommandQueueStub,
  createRecordedQueueMessage,
} from "./helpers/channel-final-delivery-queue-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001";
const APP_ID = "01J0000000000000000000000Q";
const NOW_MS = Date.parse("2026-06-26T00:00:00.000Z");

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
};

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

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

    CREATE TABLE api_command (
      attempt_count integer DEFAULT 0 NOT NULL,
      claim_expires_at integer,
      claim_owner text,
      completed_at integer,
      created_at integer NOT NULL,
      dedupe_key text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_error_code text,
      last_error_message text,
      payload_json text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX api_command_dedupe_idx ON api_command (dedupe_key);

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      created_at,
      updated_at
    )
    VALUES ('${APP_ID}', '01J00000000000000000000006', '${OWNER_ID}', 'App', 1, 1);
  `);

  return database;
}

function createBindings(database: SqliteD1Database) {
  const queue = createApiCommandQueueStub();

  return {
    bindings: {
      API_COMMAND_QUEUE: queue,
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ZONE_ID: "test-zone",
      DB: database,
      MOSOO_APP_DEPLOYMENT_DOMAIN: "apps.localhost",
    } as Pick<
      ApiBindings,
      | "API_COMMAND_QUEUE"
      | "CLOUDFLARE_ACCOUNT_ID"
      | "CLOUDFLARE_API_TOKEN"
      | "CLOUDFLARE_ZONE_ID"
      | "DB"
      | "MOSOO_APP_DEPLOYMENT_DOMAIN"
    >,
    queue,
  };
}

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

async function setDeploymentRunUpdatedAt(
  database: SqliteD1Database,
  runId: string,
  updatedAt: number,
): Promise<void> {
  await database
    .prepare("UPDATE app_deployment_run SET updated_at = ? WHERE id = ?")
    .bind(updatedAt, runId)
    .run();
}

async function seedExpiredRunningDispatch(
  database: SqliteD1Database,
  runId: string,
): Promise<void> {
  await database
    .prepare(
      "UPDATE api_command SET status = 'running', claim_owner = 'stale-owner', claim_expires_at = 1 WHERE dedupe_key = ?",
    )
    .bind(createAppDeploymentRunDispatchDedupeKey(runId))
    .run();
  await setDeploymentRunUpdatedAt(database, runId, 1);
}

const unexpectedSandboxCall = async (): Promise<never> => {
  throw new Error("Unexpected sandbox method call.");
};

const successfulCommandResult = (stdout = "") => ({
  exitCode: 0,
  stderr: "",
  stdout,
  success: true as const,
});

function createCloudflareDeleteRecorder(
  deleted: string[],
  overrides: Partial<CloudflareDeploymentClient> = {},
): CloudflareDeploymentClient {
  return {
    async deletePagesDomain(input) {
      deleted.push(`pages-domain:${input.hostname}`);
    },
    async deletePagesProject(input) {
      deleted.push(`pages:${input.projectName}`);
    },
    async deleteWorkerRoute(input) {
      deleted.push(`worker-route:${input.hostname}`);
    },
    async deleteWorkerScript(input) {
      deleted.push(`worker:${input.scriptName}`);
    },
    async deployWorkerModule() {
      throw new Error("Unexpected Worker deploy.");
    },
    async ensurePagesProject() {
      throw new Error("Unexpected Pages project creation.");
    },
    async ensurePagesDomain() {
      throw new Error("Unexpected Pages domain creation.");
    },
    async ensureWorkerRoute() {
      throw new Error("Unexpected Worker route creation.");
    },
    async getLatestPagesDeployment() {
      throw new Error("Unexpected Pages deployment read.");
    },
    ...overrides,
  };
}

function createTestSandboxHandle(
  id: string,
  events: string[],
  mode: "destroy-only" | "deployment",
): SandboxHandle {
  const base = {
    createBackup: unexpectedSandboxCall,
    deleteSession: unexpectedSandboxCall,
    getSession: unexpectedSandboxCall,
    mkdir: unexpectedSandboxCall,
    mountBucket: unexpectedSandboxCall,
    restoreBackup: unexpectedSandboxCall,
    startProcess: unexpectedSandboxCall,
    terminal: unexpectedSandboxCall,
    watch: unexpectedSandboxCall,
    wsConnect: unexpectedSandboxCall,
  };

  if (mode === "destroy-only") {
    return {
      ...base,
      createSession: unexpectedSandboxCall,
      destroy: async () => {
        events.push(id);
      },
      exec: unexpectedSandboxCall,
      readFile: unexpectedSandboxCall,
      setKeepAlive: async () => {},
      writeFile: unexpectedSandboxCall,
    } as SandboxHandle;
  }

  const session = {
    exec: async (command: string) => {
      events.push(`${id}:session:${command}`);
      return successfulCommandResult();
    },
    mkdir: unexpectedSandboxCall,
    readFile: unexpectedSandboxCall,
    startProcess: unexpectedSandboxCall,
    watch: unexpectedSandboxCall,
    writeFile: unexpectedSandboxCall,
  };

  return {
    ...base,
    createSession: async () => session,
    destroy: async () => {
      events.push(`${id}:destroy`);
    },
    exec: async (command) => {
      events.push(`${id}:${command}`);
      return successfulCommandResult(command.includes("find . -type f") ? "./index.html\n" : "");
    },
    readFile: async (_path, options) => ({
      content: options?.encoding === "base64" ? "YXJjaGl2ZQ==" : "<main>Hello</main>",
      encoding: options?.encoding ?? "utf8",
    }),
    setKeepAlive: async (keepAlive) => {
      events.push(`${id}:keep-alive:${String(keepAlive)}`);
    },
    writeFile: async (path) => {
      events.push(`${id}:write:${path}`);
    },
  } as SandboxHandle;
}

describe("app deployment service", () => {
  test("creates a deployment run and queues dispatch", async () => {
    const database = createDatabase();
    const { bindings, queue } = createBindings(database);

    const run = await deployApp(
      bindings,
      VIEWER,
      {
        appId: APP_ID,
        configPath: ".mosoo.toml",
        repoUrl: "https://github.com/samzong/awire.git",
      },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    expect(run).toMatchObject({
      liveUrl: null,
      plannedUrl: `https://app-${APP_ID.toLowerCase()}.apps.localhost`,
      sourceBranch: "main",
      sourceCommitSha: "abc123",
      status: "queued",
    });
    expect(queue.sent).toHaveLength(1);

    const command = await database.app().select().from(apiCommandsTable).limit(1).get();

    expect(command).toMatchObject({
      kind: "app_deployment_run_dispatch",
      status: "queued",
    });
    expect(JSON.parse(command?.payloadJson ?? "{}")).toEqual({
      appDeploymentRunId: run.id,
    });

    const deployment = await getAppDeployment(bindings, VIEWER, APP_ID);
    expect(deployment?.latestRun?.id).toBe(run.id);

    await database.prepare("UPDATE app_deployment SET latest_run_id = NULL").run();

    const deploymentAfterPointerDrift = await getAppDeployment(bindings, VIEWER, APP_ID);
    expect(deploymentAfterPointerDrift?.latestRun?.id).toBe(run.id);
  });

  test("rejects a second deploy while a run is active", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await expect(
      deployApp(
        bindings,
        VIEWER,
        { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
        { fetch: githubFetch, nowMs: () => NOW_MS + 1 },
      ),
    ).rejects.toThrow("An App deployment run is already active.");
  });

  test("recovers an active deployment run without a dispatch command", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    const firstRun = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await database.prepare("DELETE FROM api_command").run();
    await setDeploymentRunUpdatedAt(database, firstRun.id, 1);

    const secondRun = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS + 1 },
    );

    expect(secondRun.id).not.toBe(firstRun.id);
    expect(secondRun.status).toBe("queued");

    const firstRunRow = await database
      .app()
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, firstRun.id))
      .limit(1)
      .get();

    expect(firstRunRow).toMatchObject({
      errorCode: "deployment_dispatch_missing",
      status: "failed",
    });
  });

  test("recovers an active deployment run with an expired running dispatch command", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    const firstRun = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await seedExpiredRunningDispatch(database, firstRun.id);

    const secondRun = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS + 1 },
    );

    expect(secondRun.id).not.toBe(firstRun.id);
    expect(secondRun.status).toBe("queued");

    const firstRunRow = await database
      .app()
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, firstRun.id))
      .limit(1)
      .get();

    expect(firstRunRow).toMatchObject({
      errorCode: "deployment_dispatch_missing",
      status: "failed",
    });
  });

  test("does not fail an expired running dispatch command from status reads", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await seedExpiredRunningDispatch(database, run.id);

    await expect(getAppDeploymentStatus(bindings, VIEWER, APP_ID)).resolves.toMatchObject({
      id: run.id,
      status: "queued",
    });

    const runRow = await database
      .app()
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, run.id))
      .limit(1)
      .get();

    expect(runRow).toMatchObject({
      errorCode: null,
      status: "queued",
    });
  });

  test("keeps a fresh active deployment run without a dispatch command active", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    const firstRun = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: currentTimestampMs },
    );

    await database.prepare("DELETE FROM api_command").run();
    await setDeploymentRunUpdatedAt(database, firstRun.id, currentTimestampMs());

    await expect(
      deployApp(
        bindings,
        VIEWER,
        { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
        { fetch: githubFetch, nowMs: currentTimestampMs },
      ),
    ).rejects.toThrow("An App deployment run is already active.");

    const firstRunRow = await database
      .app()
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, firstRun.id))
      .limit(1)
      .get();

    expect(firstRunRow).toMatchObject({
      errorCode: null,
      status: "queued",
    });
  });

  test("dispatches a queued deployment run to success", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);
    const targetUrl = `https://app-${APP_ID.toLowerCase()}.apps.localhost`;
    let buildPlanName: string | null = null;
    const runner: AppDeploymentBuildRunner = {
      async build({ plan }) {
        buildPlanName = plan.generatedWranglerConfig;
      },
      async deploy() {
        return {
          externalDeploymentId: "pages-deployment-1",
          externalProjectId: "pages-project-1",
          externalVersionId: null,
          url: targetUrl,
        };
      },
      async prepare() {
        return {
          repoDir: "/repo",
          snapshot: { files: { "index.html": "<main>Hello</main>" } },
        };
      },
    };

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await dispatchAppDeploymentRun(
      bindings as ApiBindings,
      { appDeploymentRunId: run.id },
      {
        runner,
      },
    );

    const status = await getAppDeploymentStatus(bindings, VIEWER, APP_ID);
    const deployment = await getAppDeployment(bindings, VIEWER, APP_ID);
    const runRow = await database.app().select().from(appDeploymentRunsTable).limit(1).get();

    expect(buildPlanName).toContain(`name = "app-${APP_ID.toLowerCase()}"`);
    expect(status).toMatchObject({
      liveUrl: targetUrl,
      status: "success",
    });
    expect(deployment?.liveUrl).toBe(targetUrl);
    expect(runRow).toMatchObject({
      externalDeploymentId: "pages-deployment-1",
      externalProjectId: "pages-project-1",
      status: "success",
      targetKind: "cloudflare_pages",
      targetProjectName: `app-${APP_ID.toLowerCase()}`,
      url: targetUrl,
    });
  });

  test("does not delete stable Cloudflare resources when an inactive run finishes", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);
    const deleted: string[] = [];
    const targetUrl = `https://app-${APP_ID.toLowerCase()}.apps.localhost`;
    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );
    const runner: AppDeploymentBuildRunner = {
      async build() {},
      async deploy() {
        await database
          .prepare("UPDATE app_deployment_run SET status = 'failed' WHERE id = ?")
          .bind(run.id)
          .run();
        return {
          externalDeploymentId: "pages-deployment-1",
          externalProjectId: "pages-project-1",
          externalVersionId: null,
          url: targetUrl,
        };
      },
      async prepare() {
        return {
          repoDir: "/repo",
          snapshot: { files: { "index.html": "<main>Hello</main>" } },
        };
      },
    };

    await dispatchAppDeploymentRun(
      bindings as ApiBindings,
      { appDeploymentRunId: run.id },
      {
        cloudflareClient: createCloudflareDeleteRecorder(deleted),
        runner,
      },
    );

    const runRow = await database
      .app()
      .select()
      .from(appDeploymentRunsTable)
      .where(eq(appDeploymentRunsTable.id, run.id))
      .limit(1)
      .get();

    expect(deleted).toEqual([]);
    expect(runRow?.status).toBe("failed");
  });

  test("deletes the active deployment and fails the active run", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);
    const deleted: string[] = [];
    const destroyed: string[] = [];
    (bindings as ApiBindings).runtimeSubjectHandleFactory = (runtimeSubjectId) =>
      createTestSandboxHandle(runtimeSubjectId, destroyed, "destroy-only");

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await expect(
      deleteAppDeployment(
        bindings,
        VIEWER,
        { appId: APP_ID },
        {
          cloudflareClient: createCloudflareDeleteRecorder(deleted),
        },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(getAppDeployment(bindings, VIEWER, APP_ID)).resolves.toBeNull();

    const status = await getAppDeploymentStatus(bindings, VIEWER, APP_ID);
    const deploymentRow = await database.app().select().from(appDeploymentsTable).limit(1).get();
    const runRow = await database.app().select().from(appDeploymentRunsTable).limit(1).get();

    expect(status).toMatchObject({
      errorCode: "deployment_deleted",
      id: run.id,
      status: "failed",
    });
    expect(deploymentRow?.deletedAt).toBeNumber();
    expect(runRow?.status).toBe("failed");
    expect(deleted).toContain(`pages-domain:app-${APP_ID.toLowerCase()}.apps.localhost`);
    expect(deleted).toContain(`pages:app-${APP_ID.toLowerCase()}`);
    expect(deleted).toContain(`worker-route:app-${APP_ID.toLowerCase()}.apps.localhost`);
    expect(deleted).toContain(`worker:app-${APP_ID.toLowerCase()}`);
    expect(destroyed).toContain(`${run.id}-build`);
    expect(destroyed).toContain(`${run.id}-deploy`);
  });

  test("does not expose a live URL after deleting a successful deployment", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);
    const targetUrl = `https://app-${APP_ID.toLowerCase()}.apps.localhost`;
    const runner: AppDeploymentBuildRunner = {
      async build() {},
      async deploy() {
        return {
          externalDeploymentId: "pages-deployment-1",
          externalProjectId: "pages-project-1",
          externalVersionId: null,
          url: targetUrl,
        };
      },
      async prepare() {
        return {
          repoDir: "/repo",
          snapshot: { files: { "index.html": "<main>Hello</main>" } },
        };
      },
    };

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );
    await dispatchAppDeploymentRun(
      bindings as ApiBindings,
      { appDeploymentRunId: run.id },
      {
        runner,
      },
    );
    await deleteAppDeployment(
      bindings,
      VIEWER,
      { appId: APP_ID },
      {
        cloudflareClient: createCloudflareDeleteRecorder([]),
      },
    );

    await expect(getAppDeploymentStatus(bindings, VIEWER, APP_ID)).resolves.toMatchObject({
      liveUrl: null,
      status: "success",
    });
  });

  test("uses the Pages deployment URL while the custom domain is pending", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);
    const calls: string[] = [];
    const pagesUrl = "https://app-example.pages.dev";
    const cloudflareClient = createCloudflareDeleteRecorder([], {
      ensurePagesDomain: async () => ({ status: "initializing" }),
      ensurePagesProject: async () => ({ projectId: "pages-project-1" }),
      getLatestPagesDeployment: async () => ({
        deploymentId: "pages-deployment-1",
        url: pagesUrl,
      }),
    });
    (bindings as ApiBindings).runtimeSubjectHandleFactory = (runtimeSubjectId) =>
      createTestSandboxHandle(runtimeSubjectId, calls, "deployment");

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await dispatchAppDeploymentRun(
      bindings as ApiBindings,
      { appDeploymentRunId: run.id },
      { cloudflareClient },
    );

    const status = await getAppDeploymentStatus(bindings, VIEWER, APP_ID);
    const runRow = await database.app().select().from(appDeploymentRunsTable).limit(1).get();

    expect(status).toMatchObject({
      liveUrl: pagesUrl,
      status: "success",
    });
    expect(runRow).toMatchObject({
      externalDeploymentId: "pages-deployment-1",
      externalProjectId: "pages-project-1",
      status: "success",
      url: pagesUrl,
    });
    expect(calls.some((call) => call.includes("wrangler pages deploy"))).toBe(true);
  });

  test("dead letters active deployment runs without overwriting terminal runs", async () => {
    const database = createDatabase();
    const { bindings, queue } = createBindings(database);

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );
    const queued = queue.sent[0];

    if (queued === undefined) {
      throw new Error("Expected deployment dispatch queue message.");
    }

    await database.app().update(apiCommandsTable).set({ payloadJson: "{}" }).run();

    await processApiCommandDeadLetterMessage(
      bindings as ApiBindings,
      createRecordedQueueMessage({ body: queued.body }).message,
      () => NOW_MS + 1,
    );

    await expect(getAppDeploymentStatus(bindings, VIEWER, APP_ID)).resolves.toMatchObject({
      errorCode: "queue_dead_lettered",
      id: run.id,
      status: "failed",
    });

    await deleteAppDeployment(
      bindings,
      VIEWER,
      { appId: APP_ID },
      {
        cloudflareClient: createCloudflareDeleteRecorder([]),
      },
    );
    await processApiCommandDeadLetterMessage(
      bindings as ApiBindings,
      createRecordedQueueMessage({ body: queued.body }).message,
      () => NOW_MS + 2,
    );

    await expect(getAppDeploymentStatus(bindings, VIEWER, APP_ID)).resolves.toMatchObject({
      errorCode: "queue_dead_lettered",
      id: run.id,
      status: "failed",
    });
  });
});
