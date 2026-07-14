import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";

import { isCurrentDeploymentAgentCapability } from "../src/modules/apps/application/app-deployment-capability-authority.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = createPlatformId<AppId>(1);
const DEPLOYMENT_ID = createPlatformId<AppDeploymentId>(1);
const SUCCESSFUL_RUN_ID = createPlatformId<AppDeploymentRunId>(1);
const FAILED_RUN_ID = createPlatformId<AppDeploymentRunId>(1);
const REPLACEMENT_RUN_ID = createPlatformId<AppDeploymentRunId>(1);

const BINDING = { env: "MOSOO_AGENT", expose: "public_thread" as const, name: "Support" };

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

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

  return database;
}

function plan(bindings: readonly (typeof BINDING)[]): string {
  return JSON.stringify({ agentBindings: bindings });
}

async function insertDeployment(database: SqliteD1Database, deletedAt: number | null = null) {
  await database
    .prepare("INSERT INTO app_deployment (app_id, deleted_at, id) VALUES (?, ?, ?)")
    .bind(APP_ID, deletedAt, DEPLOYMENT_ID)
    .run();
}

async function insertRun(input: {
  database: SqliteD1Database;
  id: AppDeploymentRunId;
  planJson: string | null;
  status: "failed" | "success";
}) {
  await input.database
    .prepare(
      "INSERT INTO app_deployment_run (app_id, deployment_id, id, plan_json, status) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(APP_ID, DEPLOYMENT_ID, input.id, input.planJson, input.status)
    .run();
}

function authority() {
  return {
    appId: APP_ID,
    binding: BINDING,
    deploymentId: DEPLOYMENT_ID,
    deploymentRunId: SUCCESSFUL_RUN_ID,
  };
}

describe("deployment bound-agent capability authority", () => {
  test("accepts the current successful deployment binding", async () => {
    const database = createDatabase();
    await insertDeployment(database);
    await insertRun({
      database,
      id: SUCCESSFUL_RUN_ID,
      planJson: plan([BINDING]),
      status: "success",
    });

    await expect(isCurrentDeploymentAgentCapability(database, authority())).resolves.toBe(true);
  });

  test("rejects a capability after its deployment is deleted", async () => {
    const database = createDatabase();
    await insertDeployment(database, 1);
    await insertRun({
      database,
      id: SUCCESSFUL_RUN_ID,
      planJson: plan([BINDING]),
      status: "success",
    });

    await expect(isCurrentDeploymentAgentCapability(database, authority())).resolves.toBe(false);
  });

  test("keeps the prior capability valid when a newer deployment run fails", async () => {
    const database = createDatabase();
    await insertDeployment(database);
    await insertRun({
      database,
      id: SUCCESSFUL_RUN_ID,
      planJson: plan([BINDING]),
      status: "success",
    });
    await insertRun({ database, id: FAILED_RUN_ID, planJson: plan([]), status: "failed" });

    await expect(isCurrentDeploymentAgentCapability(database, authority())).resolves.toBe(true);
  });

  test("rejects a capability after a successful revision removes its binding", async () => {
    const database = createDatabase();
    await insertDeployment(database);
    await insertRun({
      database,
      id: SUCCESSFUL_RUN_ID,
      planJson: plan([BINDING]),
      status: "success",
    });
    await insertRun({ database, id: REPLACEMENT_RUN_ID, planJson: plan([]), status: "success" });

    await expect(isCurrentDeploymentAgentCapability(database, authority())).resolves.toBe(false);
  });
});
