import { describe, expect, test } from "bun:test";

import { apiCommandsTable, appDeploymentRunsTable, appDeploymentsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { processApiCommandDeadLetterMessage } from "../src/modules/api-command/application/api-command-processor";
import {
  deleteAppDeployment,
  deployApp,
  getAppDeployment,
  getAppDeploymentStatus,
} from "../src/modules/apps/application/app-deployment.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
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
      DB: database,
      MOSOO_APP_DEPLOYMENT_DOMAIN: "apps.localhost",
    } as Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB" | "MOSOO_APP_DEPLOYMENT_DOMAIN">,
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

  test("deletes the active deployment and fails the active run", async () => {
    const database = createDatabase();
    const { bindings } = createBindings(database);

    const run = await deployApp(
      bindings,
      VIEWER,
      { appId: APP_ID, repoUrl: "https://github.com/samzong/awire" },
      { fetch: githubFetch, nowMs: () => NOW_MS },
    );

    await expect(deleteAppDeployment(bindings, VIEWER, { appId: APP_ID })).resolves.toEqual({
      ok: true,
    });

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

    await deleteAppDeployment(bindings, VIEWER, { appId: APP_ID });
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
