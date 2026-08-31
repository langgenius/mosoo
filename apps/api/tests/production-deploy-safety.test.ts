import { describe, expect, test } from "bun:test";

import { MANAGED_PROD_SCHEMA_TRIGGERS } from "../bin/prod-schema-guard";
import {
  ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL,
  assertCutoverMigrationJournalAudited,
  assertProtocolV3SmokeAgent,
  assertProtocolV3Release,
  assertProtocolV3WorkerVersion,
  assertProtocolV3LegacyTerminalIntegrity,
  assertProtocolV3LegacyTerminalSourceInventory,
  assertProtocolV3LossyMigrationInventory,
  assertProtocolV3RuntimeAuthorityPreflight,
  AUDITED_MIGRATION_NAMES,
  beginProtocolV3MigrationSql,
  CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL,
  collectProtocolV3ContainerApplications,
  collectProtocolV3ContainerInstances,
  completeProtocolV3QueueResume,
  DROP_PROTOCOL_V3_CUTOVER_TRIGGERS_SQL,
  ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL,
  ENTER_PROTOCOL_V3_DRAIN_SQL,
  ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL,
  findPendingProdMigrations,
  installProtocolV3CutoverSql,
  installProtocolV3PostMigrationCutoverSql,
  INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL,
  isProtocolV3ContainerRolloutConverged,
  isProtocolV3CutoverDrained,
  isProtocolV3RuntimeDrained,
  isProtocolV3SmokeReady,
  openProtocolV3SmokeWindowSql,
  parseProtocolV3CommandFreeze,
  parseCleanGitTreeOid,
  parseProtocolV3ContainerManifestDigest,
  parseProtocolV3CutoverDrain,
  parseProtocolV3CutoverObjects,
  parseProtocolV3CutoverProbe,
  parseProtocolV3CutoverState,
  parseProtocolV3LegacyTerminalIntegrity,
  parseProtocolV3LegacyTerminalSourceInventory,
  parseProtocolV3LossyMigrationInventory,
  parseProtocolV3RuntimeAuthorityPreflight,
  parseProtocolV3SmokeStatus,
  parseProtocolV3WorkerDeployment,
  parseStoredProtocolV3SmokeRequestKey,
  parseStoredProtocolV3SmokeSession,
  parseStoredProtocolV3CutoverBookmark,
  parseTimeTravelBookmark,
  PROTOCOL_V3_COMMAND_FREEZE_SQL,
  PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_CUTOVER_OBJECTS_SQL,
  PROTOCOL_V3_CUTOVER_PROBE_SQL,
  PROTOCOL_V3_CUTOVER_QUEUE_NAMES,
  PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL,
  PROTOCOL_V3_LEGACY_TERMINAL_SOURCE_INVENTORY_SQL,
  PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL,
  PROTOCOL_V3_POST_MIGRATION_UNSAFE_SANDBOXES_SQL,
  PROTOCOL_V3_RUNTIME_AUTHORITY_PREFLIGHT_SQL,
  PROTOCOL_V3_SMOKE_REQUEST_KEY_SQL,
  PROTOCOL_V3_SMOKE_SESSION_SQL,
  protocolV3ContainerImageTag,
  protocolV3RuntimeAuthorityPreflightSql,
  protocolV3SmokeAgentSql,
  protocolV3SmokeStatusSql,
  recoverProtocolV3CutoverFailure,
  REMOVE_PROTOCOL_V3_CUTOVER_SQL,
  storeProtocolV3CutoverBookmarkSql,
  storeProtocolV3RolloutSql,
  storeProtocolV3SmokeRequestKeySql,
  storeProtocolV3SmokeSessionSql,
  updateAndVerifyProtocolV3QueueDelivery,
} from "../bin/protocol-v3-cutover";
import { applyDrizzleMigration, applyDrizzleMigrationsThrough } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const RELEASE_TREE_OID = "0123456789abcdef0123456789abcdef01234567";
const CONTAINER_IMAGE_DIGEST = "a".repeat(64);
const INSTALL_PROTOCOL_V3_CUTOVER_SQL = installProtocolV3CutoverSql(RELEASE_TREE_OID);
const EMPTY_ROLLOUT = {
  containerApplicationVersion: null,
  containerImageDigest: null,
  migrationStarted: false,
  releaseTreeOid: RELEASE_TREE_OID,
  workerVersionId: null,
} as const;
const DRAINED_CUTOVER_ROW = {
  active_project_deployment_runs: 0,
  active_runs: 0,
  live_drivers: 0,
  nonterminal_commands: 0,
  nonterminal_api_commands: 0,
  unsafe_environment_artifact_backup_staging: 0,
  unsafe_sandbox_backups: 0,
  unsafe_sandbox_backup_staging: 0,
  unsafe_sandbox_sessions: 0,
  unsafe_sandboxes: 0,
  unsafe_sessions: 0,
  unsettled_effects: 0,
} as const;
const INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL = `
  INSERT INTO environment_package_artifact_backup_staging (
    actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
    delivery_generation, dir, input_digest, paths_json, updated_at
  ) VALUES (
    NULL, 'app-1', 1, 'worker-1', 'artifact-command', 1,
    1, '/tmp/artifact', '${"0".repeat(64)}',
    '{"executable":[],"node":[],"python":[]}', 1
  )
`;

function d1Json(row: Record<string, unknown>): string {
  return JSON.stringify([{ meta: {}, results: [row], success: true }]);
}

function createCutoverGateDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  database.execute(`
    CREATE TABLE d1_migrations (name text PRIMARY KEY);
    CREATE TABLE session (
      id text PRIMARY KEY,
      creator_account_id text NOT NULL,
      end_user_id text,
      status text NOT NULL,
      status_operation_id text
    );
    CREATE TABLE sandbox (
      id text PRIMARY KEY,
      subject_kind text NOT NULL,
      subject_id text NOT NULL,
      status text NOT NULL,
      status_operation_id text,
      claim_owner text,
      claim_expires_at integer
    );
    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE sandbox_backup (
      id text PRIMARY KEY,
      status text NOT NULL,
      error_message text
    );
    CREATE TABLE session_run (
      id text PRIMARY KEY,
      status text NOT NULL,
      created_by_account_id text NOT NULL,
      session_id text NOT NULL
    );
    CREATE TABLE driver_instance (
      id text PRIMARY KEY,
      status text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL
    );
    CREATE TABLE driver_command (
      id text PRIMARY KEY,
      driver_instance_id text NOT NULL,
      kind text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE api_command (
      id text PRIMARY KEY,
      status text NOT NULL,
      claim_owner text,
      claim_expires_at integer,
      kind text NOT NULL,
      created_at integer NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      payload_json text NOT NULL DEFAULT '{}'
    );
    CREATE TABLE project_deployment_run (
      id text PRIMARY KEY,
      status text NOT NULL
    );
    CREATE TABLE external_tool_effect (id text PRIMARY KEY, status text NOT NULL);
  `);
  return database;
}

function addPostRuntimeAuthoritySchema(database: SqliteD1Database): void {
  database.execute(`
    ALTER TABLE sandbox ADD operation_kind text;
    ALTER TABLE session ADD archived_at integer;
    ALTER TABLE session ADD cleanup_operation_kind text;
    ALTER TABLE session ADD runtime_provisioning_operation_id text;
    ALTER TABLE session ADD runtime_provisioning_run_id text;
    ALTER TABLE session ADD runtime_provisioning_sandbox_id text;
    ALTER TABLE session ADD runtime_provisioning_sandbox_session_id text;
    ALTER TABLE session ADD runtime_provisioning_sandbox_incarnation integer;
    ALTER TABLE session ADD runtime_provisioning_heartbeat_at integer;
    ALTER TABLE api_command ADD delivery_generation integer NOT NULL DEFAULT 1;
    CREATE TABLE sandbox_backup_staging (
      id text PRIMARY KEY,
      sandbox_id text NOT NULL,
      workspace_session_id text
    );
    CREATE TABLE environment_package_artifact_backup_staging (
      actual_backup_id text,
      project_id text NOT NULL,
      attempt_count integer NOT NULL,
      claim_owner text NOT NULL,
      command_id text PRIMARY KEY,
      created_at integer NOT NULL,
      delivery_generation integer NOT NULL,
      dir text NOT NULL,
      input_digest text NOT NULL,
      paths_json text NOT NULL,
      updated_at integer NOT NULL
    );
  `);
}

async function readCutoverObjects(database: SqliteD1Database) {
  const row = await database
    .prepare(PROTOCOL_V3_CUTOVER_OBJECTS_SQL)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error("Cutover object inventory returned no row.");
  return parseProtocolV3CutoverObjects(d1Json(row));
}

async function readCutoverState(database: SqliteD1Database) {
  const row = await database
    .prepare(PROTOCOL_V3_COMMAND_FREEZE_SQL)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error("Cutover state returned no row.");
  return parseProtocolV3CutoverState(d1Json(row));
}

async function readLegacyTerminalIntegrity(database: SqliteD1Database) {
  const row = await database
    .prepare(PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error("Legacy terminal integrity query returned no row.");
  return parseProtocolV3LegacyTerminalIntegrity(d1Json(row));
}

async function readLegacyTerminalSourceInventory(database: SqliteD1Database) {
  const row = await database
    .prepare(PROTOCOL_V3_LEGACY_TERMINAL_SOURCE_INVENTORY_SQL)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error("Legacy terminal source inventory returned no row.");
  return parseProtocolV3LegacyTerminalSourceInventory(d1Json(row));
}

function createLegacyTerminalDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      last_run_id text,
      message_seq_cursor integer NOT NULL,
      runtime_event_seq_cursor integer NOT NULL,
      status text NOT NULL,
      status_operation_id text
    );
    CREATE TABLE session_run (
      completed_at integer,
      error_code text,
      error_details_json text,
      error_message text,
      id text PRIMARY KEY,
      session_id text NOT NULL,
      status text NOT NULL,
      status_event text NOT NULL
    );
    CREATE TABLE session_event (
      id text PRIMARY KEY,
      event_type text NOT NULL,
      run_id text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      source_event_id text NOT NULL
    );
    CREATE TABLE session_message (
      id text PRIMARY KEY,
      plan_json text,
      role text NOT NULL,
      seq integer NOT NULL,
      segments_json text,
      session_id text NOT NULL,
      session_run_id text
    );
    CREATE TABLE session_permission_request (
      id text PRIMARY KEY,
      run_id text NOT NULL,
      session_id text NOT NULL
    );
    CREATE TABLE driver_command (id text PRIMARY KEY, status text NOT NULL);
    CREATE TABLE external_tool_effect (id text PRIMARY KEY, status text NOT NULL);
  `);
  return database;
}

function createValidLegacyCompletionDatabase(): SqliteD1Database {
  const database = createLegacyTerminalDatabase();
  database.execute(`
    INSERT INTO session VALUES ('session-1', 'completed-run', 1, 1, 'IDLE', NULL);
    INSERT INTO session_run VALUES
      (100, NULL, NULL, NULL, 'completed-run', 'session-1', 'completed', 'run.complete');
    INSERT INTO session_event VALUES
      ('completed-event', 'run.completed', 'completed-run', 1, 'session-1', 'session-run-terminal:completed-run:run.completed');
    INSERT INTO session_message VALUES
      ('assistant-1', '[]', 'assistant', 1, '[]', 'session-1', 'completed-run');
  `);
  return database;
}

function containerPage(
  instances: readonly Record<string, unknown>[],
  pageToken: string | null,
  nextPageToken: string | null,
): string {
  return JSON.stringify({
    instances,
    result_info: { next_page_token: nextPageToken, page_token: pageToken, per_page: 100 },
  });
}

function containerApplication(name: string, version: number): Record<string, unknown> {
  return {
    configuration: {
      image: `registry.cloudflare.com/account/${name}@sha256:${CONTAINER_IMAGE_DIGEST}`,
    },
    health: {
      instances: { active: 1, failed: 0, healthy: 1, scheduling: 0, starting: 0 },
    },
    id: crypto.randomUUID(),
    name,
    version,
  };
}

function containerApplicationPage(
  applications: readonly Record<string, unknown>[],
  pageToken: string | null,
  nextPageToken: string | null,
): Record<string, unknown> {
  return {
    result: applications,
    result_info: { next_page_token: nextPageToken, page_token: pageToken, per_page: 100 },
    success: true,
  };
}

interface PaginationFailureFixture<T> {
  readonly collect: (readPage: (pageToken: string | null) => T) => Promise<readonly unknown[]>;
  readonly invalidMessage: string;
  readonly invalidPage: T;
  readonly label: string;
  readonly page: (pageToken: string | null, nextPageToken: string | null) => T;
}

function registerPaginationFailureTests<T>(fixture: PaginationFailureFixture<T>): void {
  test(`fails closed on repeated ${fixture.label} page tokens`, async () => {
    await expect(fixture.collect((pageToken) => fixture.page(pageToken, "page-2"))).rejects.toThrow(
      "repeated page token",
    );
  });

  test(`propagates a later ${fixture.label} page failure`, async () => {
    await expect(
      fixture.collect((pageToken) => {
        if (pageToken === null) return fixture.page(null, "page-2");
        throw new Error(`second ${fixture.label} page failed`);
      }),
    ).rejects.toThrow(`second ${fixture.label} page failed`);
  });

  test(`rejects an unexpected ${fixture.label} pagination shape`, async () => {
    await expect(fixture.collect(() => fixture.invalidPage)).rejects.toThrow(
      fixture.invalidMessage,
    );
  });

  test(`bounds ${fixture.label} pagination`, async () => {
    let pagesRead = 0;
    await expect(
      fixture.collect((pageToken) => {
        pagesRead += 1;
        return fixture.page(pageToken, `page-${pagesRead}`);
      }),
    ).rejects.toThrow("exceeded its safety limit");
    expect(pagesRead).toBe(100);
  });
}

describe("protocol v3 production cutover", () => {
  test("closes new runtime admission while existing work drains", async () => {
    const database = createCutoverGateDatabase();
    const smokeAccountId = "01J00000000000000000000001";
    const smokeSessionId = "01J0000000000000000000000A";
    const otherSessionId = "01J0000000000000000000000B";
    const smokeRequestKey = "protocol-v3-cutover-2de67417-f144-47e1-8b2e-1e71621a0d92";
    database.execute(`
      INSERT INTO session VALUES
        ('${smokeSessionId}', '${smokeAccountId}', '${smokeRequestKey}', 'IDLE', NULL),
        ('${otherSessionId}', '${smokeAccountId}', 'ordinary-user', 'IDLE', NULL);
      INSERT INTO sandbox VALUES
        ('existing-sandbox', 'session', '${smokeSessionId}', 'active', NULL, 'worker-1', 100),
        ('other-sandbox', 'session', '${otherSessionId}', 'cold', NULL, NULL, NULL);
      INSERT INTO session_run VALUES
        ('existing-run', 'queued', '${smokeAccountId}', '${smokeSessionId}');
      INSERT INTO project_deployment_run VALUES
        ('existing-app-run', 'building'),
        ('freeze-app-run', 'preparing');
      INSERT INTO driver_instance VALUES
        ('existing-driver', 'ready', 'existing-sandbox', '${smokeSessionId}'),
        ('other-existing-driver', 'stopped', 'other-sandbox', '${otherSessionId}');
      INSERT INTO api_command (
        id, status, claim_owner, claim_expires_at, kind, created_at
      ) VALUES (
        'existing-api-command', 'running', 'worker-1', 100,
        'environment_package_artifact_build', 0
      );
    `);
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);

    for (const kind of [
      "session_run_dispatch",
      "app_deployment_run_dispatch",
      "environment_package_artifact_build",
    ]) {
      for (let request = 0; request < 3; request += 1) {
        await expect(
          database
            .prepare(
              `INSERT INTO api_command (
                 id, status, claim_owner, claim_expires_at, kind, created_at
               ) VALUES (?, 'queued', NULL, NULL, ?, 1)`,
            )
            .bind(`blocked-${kind}-${request}`, kind)
            .run(),
        ).rejects.toThrow("blocks new nonterminal API commands");
      }
    }
    for (const kind of [
      "project_deployment_script_reconciliation",
      "cost_ledger_reconciliation",
      "sandbox_backup_reconciliation",
      "scheduled_maintenance",
    ]) {
      await expect(
        database
          .prepare(
            `INSERT INTO api_command (
               id, status, claim_owner, claim_expires_at, kind, created_at
             ) VALUES (?, 'queued', NULL, NULL, ?, 1)`,
          )
          .bind(`drain-${kind}`, kind)
          .run(),
      ).resolves.toBeDefined();
    }
    database.execute(`
      INSERT INTO api_command (
        id, status, claim_owner, claim_expires_at, kind, created_at
      ) VALUES (
        'terminal-business-command', 'failed', NULL, NULL,
        'environment_package_artifact_build', 0
      )
    `);
    await expect(
      database
        .prepare("UPDATE api_command SET status = 'queued' WHERE id = 'terminal-business-command'")
        .run(),
    ).rejects.toThrow("blocks API command admission");
    await expect(
      database
        .prepare(
          `UPDATE api_command
           SET kind = 'session_run_dispatch'
           WHERE id = 'drain-scheduled_maintenance'`,
        )
        .run(),
    ).rejects.toThrow("blocks API command admission");

    await expect(
      database.prepare("UPDATE session_run SET status = 'running' WHERE id = 'existing-run'").run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare("UPDATE session_run SET status = 'completed' WHERE id = 'existing-run'")
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database.prepare("UPDATE session_run SET status = 'queued' WHERE id = 'existing-run'").run(),
    ).rejects.toThrow("blocks Session Run reactivation");
    await expect(
      database
        .prepare(
          `INSERT INTO session_run VALUES ('new-run', 'queued', '${smokeAccountId}', '${smokeSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new active Session Runs");
    await expect(
      database
        .prepare(
          "UPDATE project_deployment_run SET status = 'submitting' WHERE id = 'existing-app-run'",
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          "UPDATE project_deployment_run SET status = 'success' WHERE id = 'existing-app-run'",
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          "UPDATE project_deployment_run SET status = 'activating' WHERE id = 'existing-app-run'",
        )
        .run(),
    ).rejects.toThrow("blocks App deployment Run reactivation");
    await expect(
      database.prepare("INSERT INTO project_deployment_run VALUES ('new-app-run', 'queued')").run(),
    ).rejects.toThrow("blocks new active App deployment Runs");

    await expect(
      database
        .prepare("UPDATE driver_instance SET status = 'stopping' WHERE id = 'existing-driver'")
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = 'existing-driver'")
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare("UPDATE driver_instance SET status = 'ready' WHERE id = 'existing-driver'")
        .run(),
    ).rejects.toThrow("blocks Driver reactivation");
    await expect(
      database
        .prepare(
          `INSERT INTO driver_instance VALUES ('new-driver', 'provisioning', 'existing-sandbox', '${smokeSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new live Driver instances");

    for (const kind of ["input.start", "mcp.execute"]) {
      await expect(
        database
          .prepare("INSERT INTO driver_command VALUES (?, 'existing-driver', ?, 'queued')")
          .bind(kind, kind)
          .run(),
      ).rejects.toThrow("blocks new Driver commands");
    }
    for (const kind of ["permission.resolve", "session.stop", "turn.cancel"]) {
      await expect(
        database
          .prepare("INSERT INTO driver_command VALUES (?, 'existing-driver', ?, 'queued')")
          .bind(kind, kind)
          .run(),
      ).resolves.toBeDefined();
    }

    await expect(
      database
        .prepare(
          "UPDATE sandbox SET status = 'destroying', claim_owner = NULL, claim_expires_at = NULL WHERE id = 'existing-sandbox'",
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database.prepare("UPDATE sandbox SET status = 'cold' WHERE id = 'existing-sandbox'").run(),
    ).resolves.toBeDefined();
    await expect(
      database.prepare("UPDATE sandbox SET status = 'active' WHERE id = 'existing-sandbox'").run(),
    ).rejects.toThrow("blocks sandbox activation");
    await expect(
      database
        .prepare("INSERT INTO sandbox_backup VALUES ('staging-backup', 'creating', NULL)")
        .run(),
    ).rejects.toThrow("blocks new sandbox backup work");

    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    const stillDraining = await database
      .prepare(PROTOCOL_V3_COMMAND_FREEZE_SQL)
      .first<Record<string, unknown>>();
    expect(parseProtocolV3CommandFreeze(d1Json(stillDraining))).toBeFalse();
    await expect(
      database
        .prepare(
          "UPDATE api_command SET status = 'succeeded', claim_owner = NULL, claim_expires_at = NULL WHERE id = 'existing-api-command'",
        )
        .run(),
    ).resolves.toBeDefined();
    database.execute(`
      UPDATE api_command
      SET status = 'succeeded'
      WHERE id LIKE 'drain-%'
    `);

    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    const appRunStillActive = await database
      .prepare(PROTOCOL_V3_COMMAND_FREEZE_SQL)
      .first<Record<string, unknown>>();
    expect(parseProtocolV3CommandFreeze(d1Json(appRunStillActive))).toBeFalse();
    database.execute(
      "UPDATE project_deployment_run SET status = 'failed' WHERE id = 'freeze-app-run'",
    );

    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    const frozen = await database
      .prepare(PROTOCOL_V3_COMMAND_FREEZE_SQL)
      .first<Record<string, unknown>>();
    expect(parseProtocolV3CommandFreeze(d1Json(frozen))).toBeTrue();
    await expect(
      database
        .prepare(
          "INSERT INTO driver_command VALUES ('frozen-control', 'existing-driver', 'session.stop', 'queued')",
        )
        .run(),
    ).rejects.toThrow("blocks new Driver commands");

    await expect(
      database
        .prepare("UPDATE api_command SET status = 'queued' WHERE id = 'existing-api-command'")
        .run(),
    ).rejects.toThrow("blocks API command admission");
    await expect(
      database
        .prepare(
          "UPDATE api_command SET status = 'queued' WHERE id = 'drain-scheduled_maintenance'",
        )
        .run(),
    ).rejects.toThrow("blocks API command admission");
    for (const status of ["queued", "running"]) {
      await expect(
        database
          .prepare(
            `INSERT INTO api_command (
               id, status, claim_owner, claim_expires_at, kind, created_at
             ) VALUES (?, ?, NULL, NULL, 'scheduled_maintenance', 1)`,
          )
          .bind(`frozen-${status}`, status)
          .run(),
      ).rejects.toThrow("blocks new nonterminal API commands");
    }

    database.execute(openProtocolV3SmokeWindowSql(smokeAccountId));
    await expect(
      database
        .prepare(
          `INSERT INTO session_run VALUES ('smoke-run-before-request', 'queued', '${smokeAccountId}', '${smokeSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new active Session Runs");
    database.execute(storeProtocolV3SmokeRequestKeySql(smokeRequestKey));
    await expect(
      database
        .prepare(
          `INSERT INTO session_run VALUES ('smoke-run', 'queued', '${smokeAccountId}', '${smokeSessionId}')`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `INSERT INTO session_run VALUES ('same-account-run', 'queued', '${smokeAccountId}', '${otherSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new active Session Runs");
    await expect(
      database
        .prepare(
          `INSERT INTO driver_instance VALUES ('smoke-driver', 'provisioning', 'existing-sandbox', '${smokeSessionId}')`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `INSERT INTO driver_instance VALUES ('other-driver', 'provisioning', 'other-sandbox', '${otherSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new live Driver instances");
    await expect(
      database.prepare("UPDATE sandbox SET status = 'active' WHERE id = 'existing-sandbox'").run(),
    ).resolves.toBeDefined();
    await expect(
      database.prepare("UPDATE sandbox SET status = 'active' WHERE id = 'other-sandbox'").run(),
    ).rejects.toThrow("blocks sandbox activation");
    await expect(
      database
        .prepare(
          `INSERT INTO sandbox_session VALUES ('${smokeSessionId}', 'existing-sandbox', 'active')`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `INSERT INTO sandbox_session VALUES ('${otherSessionId}', 'other-sandbox', 'active')`,
        )
        .run(),
    ).rejects.toThrow("blocks new active sandbox Sessions");
    await expect(
      database
        .prepare(
          `UPDATE session SET status_operation_id = 'smoke-operation' WHERE id = '${smokeSessionId}'`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `UPDATE session SET status_operation_id = 'ordinary-operation' WHERE id = '${otherSessionId}'`,
        )
        .run(),
    ).rejects.toThrow("blocks Session operation acquisition");
    await expect(
      database
        .prepare(
          "INSERT INTO driver_command VALUES ('smoke-input', 'smoke-driver', 'input.start', 'queued')",
        )
        .run(),
    ).rejects.toThrow("blocks new Driver commands");
    await expect(
      database
        .prepare(
          "INSERT INTO driver_command VALUES ('smoke-stop', 'smoke-driver', 'session.stop', 'queued')",
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          "INSERT INTO driver_command VALUES ('other-stop', 'other-existing-driver', 'session.stop', 'queued')",
        )
        .run(),
    ).rejects.toThrow("blocks new Driver commands");

    database.execute(CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL);
    await expect(
      database
        .prepare(
          "INSERT INTO driver_command VALUES ('closed-again', 'existing-driver', 'session.stop', 'queued')",
        )
        .run(),
    ).rejects.toThrow("blocks new Driver commands");

    database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    await expect(
      database
        .prepare(
          `INSERT INTO session_run VALUES ('after-cutover', 'queued', '${smokeAccountId}', '${smokeSessionId}')`,
        )
        .run(),
    ).resolves.toBeDefined();
  });

  test("parses the fail-closed migration and drain probes", () => {
    expect(
      parseProtocolV3CutoverProbe(
        `[wrangler warning]\n${d1Json({
          gate_present: 1,
        })}`,
      ),
    ).toEqual({ gatePresent: true });
    expect(() => parseProtocolV3CutoverProbe(d1Json({ gate_present: 2 }))).toThrow("zero or one");

    const localMigrations = [
      "0014_durable-mcp-effect-v3.sql",
      "0015_session-event-stream-identity.sql",
      "0020_runtime-subject-operation-authority.sql",
    ];
    expect(() => assertCutoverMigrationJournalAudited(AUDITED_MIGRATION_NAMES)).not.toThrow();
    expect(() =>
      assertCutoverMigrationJournalAudited([...AUDITED_MIGRATION_NAMES, "0021_unreviewed.sql"]),
    ).toThrow("audited only through 0021_sandbox-backup-object-authority.sql");
    expect(() =>
      assertCutoverMigrationJournalAudited([
        ...AUDITED_MIGRATION_NAMES.slice(0, -1),
        "0018_z_unreviewed.sql",
        AUDITED_MIGRATION_NAMES.at(-1) ?? "",
      ]),
    ).toThrow("audited only through 0021_sandbox-backup-object-authority.sql");
    expect(() =>
      assertCutoverMigrationJournalAudited(AUDITED_MIGRATION_NAMES.with(18, "0018_replaced.sql")),
    ).toThrow("audited only through 0021_sandbox-backup-object-authority.sql");
    const remoteLedger = JSON.stringify([
      {
        results: localMigrations.slice(0, 2).map((name) => ({ name })),
        success: true,
      },
    ]);
    const pending = findPendingProdMigrations(remoteLedger, localMigrations);
    expect(pending).toEqual(["0020_runtime-subject-operation-authority.sql"]);
    expect(
      findPendingProdMigrations(
        JSON.stringify([
          {
            results: [{ name: localMigrations[1] }, { name: localMigrations[0] }],
            success: true,
          },
        ]),
        localMigrations,
      ),
    ).toEqual(["0020_runtime-subject-operation-authority.sql"]);
    expect(() =>
      findPendingProdMigrations(
        JSON.stringify([
          {
            results: [{ name: localMigrations[0] }, { name: localMigrations[2] }],
            success: true,
          },
        ]),
        localMigrations,
      ),
    ).toThrow("not an exact prefix");
    const blocked = parseProtocolV3CutoverDrain(
      d1Json({
        ...DRAINED_CUTOVER_ROW,
        nonterminal_commands: 1,
      }),
    );
    expect(isProtocolV3RuntimeDrained(blocked)).toBeTrue();
    expect(isProtocolV3CutoverDrained(blocked)).toBeFalse();
    const claimedEffect = parseProtocolV3CutoverDrain(
      d1Json({
        ...DRAINED_CUTOVER_ROW,
        unsettled_effects: 1,
      }),
    );
    expect(isProtocolV3RuntimeDrained(claimedEffect)).toBeFalse();
    expect(isProtocolV3CutoverDrained(claimedEffect)).toBeFalse();
    for (const blockedAuthority of [
      { active_project_deployment_runs: 1 },
      { nonterminal_api_commands: 1 },
      { unsafe_environment_artifact_backup_staging: 1 },
    ]) {
      const state = parseProtocolV3CutoverDrain(
        d1Json({ ...DRAINED_CUTOVER_ROW, ...blockedAuthority }),
      );
      expect(isProtocolV3RuntimeDrained(state)).toBeFalse();
      expect(isProtocolV3CutoverDrained(state)).toBeFalse();
    }
    for (const activeRuntime of [
      { active_runs: 1, live_drivers: 0 },
      { active_runs: 0, live_drivers: 1 },
    ]) {
      const state = parseProtocolV3CutoverDrain(
        d1Json({
          ...DRAINED_CUTOVER_ROW,
          ...activeRuntime,
        }),
      );
      expect(isProtocolV3RuntimeDrained(state)).toBeFalse();
      expect(isProtocolV3CutoverDrained(state)).toBeFalse();
    }
    expect(
      isProtocolV3CutoverDrained(
        parseProtocolV3CutoverDrain(
          d1Json({
            ...DRAINED_CUTOVER_ROW,
          }),
        ),
      ),
    ).toBeTrue();
  });

  test("bounds the read-only migration 0014 loss inventory and fails on any candidate", async () => {
    const database = new SqliteD1Database();
    applyDrizzleMigrationsThrough(database, "0013_agent-task-snapshot-state");
    const row = await database
      .prepare(PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL)
      .first<Record<string, unknown>>();
    const empty = parseProtocolV3LossyMigrationInventory(d1Json(row ?? {}));
    expect(empty.totalCandidates).toBe(0);
    expect(empty.candidateIds).toEqual([]);
    expect(() => assertProtocolV3LossyMigrationInventory(empty)).not.toThrow();

    const candidateIds = Array.from({ length: 50 }, (_, index) => [
      "mcp_argument_omission",
      `01${"0".repeat(22)}${String(index).padStart(2, "0")}`,
    ]);
    const blockedRow = {
      attempt_completion_time_fabrications: 0,
      candidate_ids_json: JSON.stringify(candidateIds),
      command_error_omissions: 0,
      command_payload_conflicts: 0,
      control_reason_omissions: 0,
      input_start_result_omissions: 0,
      input_text_omissions: 0,
      mcp_argument_omissions: 51,
      mcp_command_terminal_conflicts: 0,
      mcp_result_conflicts: 0,
      mcp_result_omissions: 0,
      orphan_effects: 0,
      provider_receipt_losses: 0,
      permission_payload_rewrites: 0,
      session_run_error_omissions: 0,
      total_candidates: 51,
    };
    const blocked = parseProtocolV3LossyMigrationInventory(d1Json(blockedRow));
    expect(blocked.candidateIds).toHaveLength(50);
    expect(() => assertProtocolV3LossyMigrationInventory(blocked)).toThrow(
      "No lossy migration candidates are authorized",
    );
    expect(() =>
      parseProtocolV3LossyMigrationInventory(
        d1Json({
          ...blockedRow,
          candidate_ids_json: JSON.stringify([
            ...candidateIds,
            ["mcp_argument_omission", "01000000000000000000000050"],
          ]),
        }),
      ),
    ).toThrow("candidate ID count is inconsistent");
  });

  test("runs the migration 0014 loss preflight before migrations and keeps a direct guard", async () => {
    const deploySource = await Bun.file(new URL("../bin/deploy-prod.ts", import.meta.url)).text();
    const cutoverSource = deploySource.slice(
      deploySource.indexOf("async function runProtocolV3Cutover"),
    );
    expect(cutoverSource.indexOf("verifyProdLossyMigrationInventory();")).toBeGreaterThanOrEqual(0);
    expect(cutoverSource.indexOf("verifyProdLossyMigrationInventory();")).toBeLessThan(
      cutoverSource.indexOf("applyD1Migrations();"),
    );

    const migrationSource = await Bun.file(
      new URL("../../../pkgs/db/drizzle/0014_durable-mcp-effect-v3.sql", import.meta.url),
    ).text();
    const lossGuard = migrationSource.indexOf("__durable_mcp_v3_loss_guard");
    expect(lossGuard).toBeGreaterThanOrEqual(0);
    expect(lossGuard).toBeLessThan(migrationSource.indexOf("ALTER TABLE `driver_command`"));
    expect(lossGuard).toBeLessThan(migrationSource.indexOf("UPDATE `driver_command`"));
  });

  test("rebuilds the exact post-migration gate before old Workers can reacquire work", async () => {
    const database = createCutoverGateDatabase();
    const accountId = "01J00000000000000000000001";
    const smokeSessionId = "01J0000000000000000000000A";
    const otherSessionId = "01J0000000000000000000000B";
    const requestKey = "protocol-v3-cutover-2de67417-f144-47e1-8b2e-1e71621a0d92";
    database.execute(`
      INSERT INTO session VALUES
        ('${smokeSessionId}', '${accountId}', '${requestKey}', 'IDLE', NULL),
        ('${otherSessionId}', '${accountId}', 'ordinary-user', 'IDLE', NULL);
      INSERT INTO sandbox VALUES
        ('smoke-sandbox', 'session', '${smokeSessionId}', 'cold', NULL, NULL, NULL),
        ('other-sandbox', 'session', '${otherSessionId}', 'cold', NULL, NULL, NULL);
      INSERT INTO api_command (
        id, status, claim_owner, claim_expires_at, kind, created_at,
        attempt_count, payload_json
      ) VALUES (
        'artifact-command', 'running', 'worker-1', 9000000000000000,
        'environment_package_artifact_build', 0, 1,
        '{"projectId":"app-1","inputDigest":"${"0".repeat(64)}"}'
      );
    `);
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    addPostRuntimeAuthoritySchema(database);
    database.execute(INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });
    database.execute(
      `INSERT INTO api_command (
         id, status, claim_owner, claim_expires_at, kind, created_at,
         attempt_count, payload_json, delivery_generation
       ) VALUES (
         'terminal-command', 'succeeded', NULL, NULL, 'scheduled_maintenance', 0,
         0, '{}', 1
       )`,
    );

    const gate = await database
      .prepare('SELECT started_at AS startedAt FROM "__protocol_v3_cutover" WHERE id = 1')
      .first<{ startedAt: number }>();
    if (gate === null) throw new Error("Expected the protocol v3 cutover gate.");
    database.execute(
      `UPDATE api_command SET created_at = ${gate.startedAt + 1}
       WHERE id = 'artifact-command'`,
    );
    await expect(database.prepare(INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL).run()).rejects.toThrow(
      "blocks new environment artifact backup staging",
    );
    database.execute("UPDATE api_command SET created_at = 0 WHERE id = 'artifact-command'");
    await expect(
      database
        .prepare(INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL.replace("'worker-1'", "'wrong-owner'"))
        .run(),
    ).rejects.toThrow("blocks new environment artifact backup staging");
    await expect(
      database.prepare(INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL).run(),
    ).resolves.toBeDefined();
    database.execute(`
      DELETE FROM environment_package_artifact_backup_staging
      WHERE command_id = 'artifact-command';
      UPDATE api_command
      SET status = 'succeeded', claim_owner = NULL, claim_expires_at = NULL
      WHERE id = 'artifact-command';
    `);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    await expect(
      database
        .prepare("UPDATE api_command SET delivery_generation = 2 WHERE id = 'terminal-command'")
        .run(),
    ).rejects.toThrow("blocks API command admission");
    await expect(database.prepare(INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL).run()).rejects.toThrow(
      "blocks new environment artifact backup staging",
    );

    await expect(
      database
        .prepare(
          `UPDATE session SET runtime_provisioning_operation_id = 'ordinary-operation' WHERE id = '${otherSessionId}'`,
        )
        .run(),
    ).rejects.toThrow("blocks Session operation acquisition");
    await expect(
      database
        .prepare(
          `UPDATE session SET archived_at = 1, cleanup_operation_kind = 'archive' WHERE id = '${otherSessionId}'`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `UPDATE session SET cleanup_operation_kind = 'delete' WHERE id = '${otherSessionId}'`,
        )
        .run(),
    ).rejects.toThrow("blocks Session operation acquisition");
    await expect(
      database
        .prepare("UPDATE sandbox SET operation_kind = 'activate' WHERE id = 'other-sandbox'")
        .run(),
    ).rejects.toThrow("blocks sandbox activation");
    await expect(
      database
        .prepare(
          `INSERT INTO sandbox_backup_staging VALUES ('ordinary-staging', 'other-sandbox', '${otherSessionId}')`,
        )
        .run(),
    ).rejects.toThrow("blocks new sandbox backup staging");

    database.execute(openProtocolV3SmokeWindowSql(accountId));
    database.execute(storeProtocolV3SmokeRequestKeySql(requestKey));
    await expect(
      database
        .prepare(
          `UPDATE session SET runtime_provisioning_operation_id = 'smoke-operation' WHERE id = '${smokeSessionId}'`,
        )
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare("UPDATE sandbox SET operation_kind = 'activate' WHERE id = 'smoke-sandbox'")
        .run(),
    ).resolves.toBeDefined();
    await expect(
      database
        .prepare(
          `INSERT INTO sandbox_backup_staging VALUES ('smoke-staging', 'smoke-sandbox', '${smokeSessionId}')`,
        )
        .run(),
    ).resolves.toBeDefined();

    database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL);
    expect(
      await database
        .prepare('SELECT count(*) AS count FROM "__protocol_v3_cutover"')
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });
    database.execute(installProtocolV3PostMigrationCutoverSql(RELEASE_TREE_OID));
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });
  });

  test("migration 0020 preserves the exact preinstalled cutover gate", async () => {
    const database = new SqliteD1Database();
    applyDrizzleMigrationsThrough(database, "0020_runtime-subject-operation-authority");
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);

    applyDrizzleMigration(database, "0021_sandbox-backup-object-authority");

    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });
  });

  test("reports legacy identity and backup rows that migration 0020 will reject atomically", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE project (id text PRIMARY KEY);
      CREATE TABLE agent (
        id text PRIMARY KEY,
        project_id text NOT NULL,
        kind text NOT NULL,
        owner_account_id text NOT NULL
      );
      CREATE TABLE session (
        id text PRIMARY KEY,
        agent_id text NOT NULL,
        project_id text NOT NULL,
        kind text NOT NULL,
        archived_at integer,
        cleanup_operation_kind text,
        runtime_provisioning_heartbeat_at integer,
        runtime_provisioning_operation_id text,
        runtime_provisioning_run_id text,
        runtime_provisioning_sandbox_id text,
        status text NOT NULL,
        status_operation_id text
      );
      CREATE TABLE session_run (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        agent_id text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE sandbox_session (
        session_id text NOT NULL,
        sandbox_id text NOT NULL,
        cwd text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE sandbox (
        id text PRIMARY KEY,
        kind text NOT NULL,
        subject_kind text NOT NULL,
        subject_id text NOT NULL,
        agent_id text,
        project_id text,
        owner_account_id text,
        last_backup_id text,
        last_restore_backup_id text
      );
      CREATE TABLE driver_instance (id text PRIMARY KEY, generation);
      CREATE TABLE preflight_parent (id text PRIMARY KEY);
      CREATE TABLE preflight_child (
        id text PRIMARY KEY,
        parent_id text REFERENCES preflight_parent(id)
      );
      CREATE TABLE sandbox_backup (
        id text PRIMARY KEY,
        sandbox_id text NOT NULL,
        dir text NOT NULL,
        session_run_id text,
        status text NOT NULL,
        error_message text,
        keep integer NOT NULL,
        ttl_seconds integer NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      INSERT INTO project VALUES ('app-1');
      INSERT INTO agent VALUES ('agent-1', 'app-1', 'cattle', 'account-1');
      INSERT INTO session (
        id, agent_id, project_id, kind, status
      ) VALUES ('session-1', 'agent-1', 'app-1', 'cattle', 'IDLE');
      INSERT INTO session_run VALUES ('run-1', 'session-1', 'agent-1', 'completed');
      INSERT INTO sandbox_session VALUES ('session-1', 'sandbox-1', '/workspace', 'closed');
      INSERT INTO sandbox (
        id, kind, subject_kind, subject_id, agent_id, project_id, owner_account_id
      ) VALUES ('sandbox-1', 'cattle', 'session', 'session-1', NULL, NULL, NULL);
      INSERT INTO sandbox_backup VALUES (
        'backup-1', 'sandbox-1', '/workspace', 'run-1', 'ready', NULL, 0, 3600, 1, 2
      );
    `);
    const readPreflight = async () =>
      parseProtocolV3RuntimeAuthorityPreflight(
        d1Json(
          await database
            .prepare(PROTOCOL_V3_RUNTIME_AUTHORITY_PREFLIGHT_SQL)
            .first<Record<string, unknown>>(),
        ),
      );
    const valid = await readPreflight();
    expect(() => assertProtocolV3RuntimeAuthorityPreflight(valid)).not.toThrow();

    database.execute("INSERT INTO driver_instance VALUES ('driver-1', 1.5)");
    expect((await readPreflight()).invalidDriverGenerations).toBe(1);
    database.execute("DELETE FROM driver_instance");

    database.execute("UPDATE sandbox SET last_backup_id = 'missing' WHERE id = 'sandbox-1'");
    expect((await readPreflight()).invalidSandboxBackupPointers).toBe(1);
    database.execute("UPDATE sandbox SET last_backup_id = NULL WHERE id = 'sandbox-1'");

    database.execute(
      "UPDATE session SET runtime_provisioning_operation_id = 'operation-1' WHERE id = 'session-1'",
    );
    expect((await readPreflight()).nonstaticSessions).toBe(1);
    database.execute(
      "UPDATE session SET runtime_provisioning_operation_id = NULL WHERE id = 'session-1'",
    );

    database.execute("UPDATE sandbox_session SET sandbox_id = 'other-sandbox'");
    expect((await readPreflight()).invalidSandboxSessionAuthorities).toBe(1);
    database.execute("UPDATE sandbox_session SET sandbox_id = 'sandbox-1'");

    database.execute(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO preflight_child VALUES ('child-1', 'missing-parent');
      PRAGMA foreign_keys = ON;
    `);
    expect((await readPreflight()).foreignKeyViolations).toBe(1);
    database.execute(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM preflight_child;
      PRAGMA foreign_keys = ON;
    `);

    for (const [breakAuthority, restoreAuthority] of [
      [
        "UPDATE session_run SET status = 'failed' WHERE id = 'run-1'",
        "UPDATE session_run SET status = 'completed' WHERE id = 'run-1'",
      ],
      [
        "UPDATE session_run SET agent_id = 'other-agent' WHERE id = 'run-1'",
        "UPDATE session_run SET agent_id = 'agent-1' WHERE id = 'run-1'",
      ],
      [
        "UPDATE sandbox_session SET sandbox_id = 'other-sandbox'",
        "UPDATE sandbox_session SET sandbox_id = 'sandbox-1'",
      ],
      [
        "UPDATE sandbox_session SET cwd = '/other'",
        "UPDATE sandbox_session SET cwd = '/workspace'",
      ],
      [
        "UPDATE sandbox_backup SET dir = '' WHERE id = 'backup-1'",
        "UPDATE sandbox_backup SET dir = '/workspace' WHERE id = 'backup-1'",
      ],
    ] as const) {
      database.execute(breakAuthority);
      expect((await readPreflight()).invalidSandboxBackups).toBe(1);
      database.execute(restoreAuthority);
    }

    database.execute("UPDATE sandbox SET agent_id = 'agent-1' WHERE id = 'sandbox-1'");
    expect((await readPreflight()).invalidSandboxIdentities).toBe(1);
    database.execute(
      "UPDATE sandbox SET agent_id = NULL, project_id = NULL, owner_account_id = NULL WHERE id = 'sandbox-1'",
    );
    database.execute(`
      INSERT INTO sandbox_backup VALUES (
        'backup-2', 'sandbox-1', '/workspace', 'run-1', 'pruned', NULL, 1, 3600, 2, 3
      );
    `);
    const invalid = await readPreflight();
    expect(invalid.duplicateSandboxBackups).toBe(1);
    expect(() => assertProtocolV3RuntimeAuthorityPreflight(invalid)).toThrow(
      "Migration 0020 remains the atomic authority",
    );
  });

  test("preflights the real 0013 schema without reading 0016 Session columns", async () => {
    const database = new SqliteD1Database();
    applyDrizzleMigrationsThrough(database, "0013_agent-task-snapshot-state");
    const readPreflight = async () =>
      parseProtocolV3RuntimeAuthorityPreflight(
        d1Json(
          await database
            .prepare(protocolV3RuntimeAuthorityPreflightSql(true))
            .first<Record<string, unknown>>(),
        ),
      );

    const clean = await readPreflight();
    expect(() => assertProtocolV3RuntimeAuthorityPreflight(clean)).not.toThrow();
    database.execute(`
      INSERT INTO session (
        agent_id, created_at, creator_account_id, id, kind, model, project_id,
        provider, renamed, runtime_id, status, updated_at
      ) VALUES (
        '01J0000000000000000000001A', 1, '01J0000000000000000000001B',
        '01J0000000000000000000001C', 'cattle', 'model',
        '01J0000000000000000000001D', 'provider', 0, 'codex', 'RUNNING', 1
      )
    `);
    expect((await readPreflight()).nonstaticSessions).toBe(1);
  });

  test("checks 0016 Session authority columns once migration 0016 is applied", async () => {
    const database = new SqliteD1Database();
    applyDrizzleMigrationsThrough(database, "0016_session-cleanup-operation");
    database.execute(`
      INSERT INTO session (
        agent_id, created_at, creator_account_id, id, kind, model, project_id,
        provider, renamed, runtime_id, runtime_provisioning_heartbeat_at,
        runtime_provisioning_operation_id, runtime_provisioning_sandbox_id,
        status, updated_at
      ) VALUES (
        '01J0000000000000000000001A', 1, '01J0000000000000000000001B',
        '01J0000000000000000000001C', 'cattle', 'model',
        '01J0000000000000000000001D', 'provider', 0, 'codex', 1,
        '01J0000000000000000000001E', '01J0000000000000000000001F',
        'IDLE', 1
      )
    `);
    const preflight = parseProtocolV3RuntimeAuthorityPreflight(
      d1Json(
        await database
          .prepare(protocolV3RuntimeAuthorityPreflightSql(false))
          .first<Record<string, unknown>>(),
      ),
    );

    expect(preflight.nonstaticSessions).toBe(1);
    expect(() => assertProtocolV3RuntimeAuthorityPreflight(preflight)).toThrow(
      "nonstaticSessions=1",
    );
  });

  test("counts every post-migration authority lease before declaring the boundary drained", async () => {
    const database = createCutoverGateDatabase();
    addPostRuntimeAuthoritySchema(database);
    database.execute(`
      INSERT INTO session VALUES (
        'session-1', 'account-1', 'user-1', 'IDLE', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      INSERT INTO sandbox VALUES (
        'sandbox-1', 'session', 'session-1', 'cold', NULL, NULL, NULL, NULL
      );
    `);
    const readDrain = async () =>
      parseProtocolV3CutoverDrain(
        d1Json(
          await database
            .prepare(PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL)
            .first<Record<string, unknown>>(),
        ),
      );
    expect(isProtocolV3CutoverDrained(await readDrain())).toBeTrue();

    for (const [column, value] of [
      ["cleanup_operation_kind", "'archive'"],
      ["runtime_provisioning_operation_id", "'operation-1'"],
      ["runtime_provisioning_run_id", "'run-1'"],
      ["runtime_provisioning_sandbox_id", "'sandbox-1'"],
      ["runtime_provisioning_sandbox_session_id", "'sandbox-session-1'"],
      ["runtime_provisioning_sandbox_incarnation", "1"],
      ["runtime_provisioning_heartbeat_at", "1"],
    ] as const) {
      database.execute(`UPDATE session SET "${column}" = ${value} WHERE id = 'session-1'`);
      expect((await readDrain()).unsafeSessions).toBe(1);
      database.execute(`UPDATE session SET "${column}" = NULL WHERE id = 'session-1'`);
    }

    database.execute(
      "UPDATE session SET archived_at = 1, cleanup_operation_kind = 'archive' WHERE id = 'session-1'",
    );
    expect(isProtocolV3CutoverDrained(await readDrain())).toBeTrue();
    database.execute("UPDATE session SET cleanup_operation_kind = 'delete' WHERE id = 'session-1'");
    expect((await readDrain()).unsafeSessions).toBe(1);
    database.execute(
      "UPDATE session SET archived_at = NULL, cleanup_operation_kind = NULL WHERE id = 'session-1'",
    );

    database.execute("UPDATE sandbox SET operation_kind = 'activate' WHERE id = 'sandbox-1'");
    expect((await readDrain()).unsafeSandboxes).toBe(1);
    expect(
      await database.prepare(PROTOCOL_V3_POST_MIGRATION_UNSAFE_SANDBOXES_SQL).first<string>("id"),
    ).toBe("sandbox-1");
    database.execute("UPDATE sandbox SET operation_kind = NULL WHERE id = 'sandbox-1'");
    database.execute(
      "INSERT INTO sandbox_backup_staging VALUES ('staging-1', 'sandbox-1', 'session-1')",
    );
    expect((await readDrain()).unsafeSandboxBackupStaging).toBe(1);
    database.execute(INSERT_ENVIRONMENT_ARTIFACT_STAGING_SQL);
    expect((await readDrain()).unsafeEnvironmentArtifactBackupStaging).toBe(1);
    database.execute("INSERT INTO project_deployment_run VALUES ('active-app-run', 'activating')");
    expect((await readDrain()).activeAppDeploymentRuns).toBe(1);
    expect(isProtocolV3CutoverDrained(await readDrain())).toBeFalse();
  });

  test("allows only deterministic legacy terminal normalization before migration 0015", async () => {
    const database = createLegacyTerminalDatabase();
    database.execute(`
      INSERT INTO session VALUES ('session-1', 'failed-run', 1, 3, 'IDLE', NULL);
      INSERT INTO session_run VALUES
        (100, NULL, NULL, NULL, 'completed-run', 'session-1', 'completed', 'run.complete'),
        (100, 'runtime.failed', NULL, 'Run failed', 'failed-run', 'session-1', 'failed', 'run.fail');
      INSERT INTO session_event VALUES
        ('completed-event', 'run.completed', 'completed-run', 1, 'session-1', 'session-run-terminal:completed-run:run.completed'),
        ('failed-event', 'run.failed', 'failed-run', 2, 'session-1', 'session-run-terminal:failed-run:run.failed'),
        ('message-event', 'message.added', 'completed-run', 3, 'session-1', 'message-source');
      INSERT INTO session_message VALUES
        ('assistant-1', '[]', 'assistant', 1, '[]', 'session-1', 'completed-run');
    `);

    const integrity = await readLegacyTerminalIntegrity(database);
    expect(integrity).toEqual({
      ambiguousAssistantRuns: 0,
      duplicateTerminalRuns: 0,
      invalidFailedRuns: 0,
      invalidNonfailedRunErrors: 0,
      invalidTerminalLinks: 0,
      legacyMaterializedMessages: 1,
      legacyStreamRows: 1,
      legacyTerminalEvents: 2,
      mismatchedTerminalEvents: 0,
      missingTerminalEvents: 0,
      noncanonicalTerminalSources: 0,
      nonterminalCommands: 0,
      partialAssistantProjections: 0,
      partialTerminalProjections: 0,
      repairableFailedRuns: 1,
      rewriteCandidateManifestJson: "[]",
      unsettledEffects: 0,
    });
    expect(() => assertProtocolV3LegacyTerminalIntegrity(integrity)).not.toThrow();
    const sourceInventory = await readLegacyTerminalSourceInventory(database);
    expect(sourceInventory).toEqual({
      cancelled: { canonical: 0, canonicalTargetCollisions: 0, noncanonical: 0, total: 0 },
      completed: { canonical: 1, canonicalTargetCollisions: 0, noncanonical: 0, total: 1 },
      failed: { canonical: 1, canonicalTargetCollisions: 0, noncanonical: 0, total: 1 },
      invalidTerminalLinks: 0,
      mismatchedTerminalEvents: 0,
      multipleTerminalRuns: 0,
    });
    expect(() => assertProtocolV3LegacyTerminalSourceInventory(sourceInventory)).not.toThrow();
  });

  test("inventories deterministic source rewrites but rejects collisions and multiple terminals", async () => {
    const database = createValidLegacyCompletionDatabase();
    database.execute(`
      UPDATE session_event
      SET source_event_id = 'provider-completion-event'
      WHERE id = 'completed-event';
      INSERT INTO session_event VALUES
        ('canonical-source-owner', 'message.added', 'completed-run', 2, 'session-1', 'session-run-terminal:completed-run:run.completed'),
        ('second-terminal', 'run.failed', 'completed-run', 3, 'session-1', 'session-run-terminal:completed-run:run.failed');
    `);

    const inventory = await readLegacyTerminalSourceInventory(database);
    expect(inventory).toEqual({
      cancelled: { canonical: 0, canonicalTargetCollisions: 0, noncanonical: 0, total: 0 },
      completed: { canonical: 0, canonicalTargetCollisions: 1, noncanonical: 1, total: 1 },
      failed: { canonical: 1, canonicalTargetCollisions: 0, noncanonical: 0, total: 1 },
      invalidTerminalLinks: 0,
      mismatchedTerminalEvents: 1,
      multipleTerminalRuns: 1,
    });
    expect(() => assertProtocolV3LegacyTerminalSourceInventory(inventory)).toThrow(
      "not ready for the protocol v3 production cutover",
    );
  });

  test("allows collision-free provider sources as deterministic migration rewrite candidates", async () => {
    const database = createValidLegacyCompletionDatabase();
    database.execute(
      "UPDATE session_event SET source_event_id = 'provider-completion-event' WHERE id = 'completed-event'",
    );

    const inventory = await readLegacyTerminalSourceInventory(database);
    expect(inventory.completed).toEqual({
      canonical: 0,
      canonicalTargetCollisions: 0,
      noncanonical: 1,
      total: 1,
    });
    expect(() => assertProtocolV3LegacyTerminalSourceInventory(inventory)).not.toThrow();
    const integrity = await readLegacyTerminalIntegrity(database);
    expect(JSON.parse(integrity.rewriteCandidateManifestJson)).toEqual([
      [
        "completed-event",
        "session-1",
        "completed-run",
        "run.completed",
        "provider-completion-event",
        1,
      ],
    ]);
  });

  for (const fixture of [
    {
      blocker: "mismatchedTerminalEvents",
      label: "a source rewrite whose event kind conflicts with its Run",
      mutate: "UPDATE session_run SET status = 'failed' WHERE id = 'completed-run'",
    },
    {
      blocker: "invalidTerminalLinks",
      label: "a source rewrite without an exact Run link",
      mutate: "UPDATE session_event SET run_id = 'unknown-run' WHERE id = 'completed-event'",
    },
  ] as const) {
    test(`rejects ${fixture.label} in the read-only inventory`, async () => {
      const database = createValidLegacyCompletionDatabase();
      database.execute(fixture.mutate);

      const inventory = await readLegacyTerminalSourceInventory(database);
      expect(inventory[fixture.blocker]).toBe(1);
      expect(() => assertProtocolV3LegacyTerminalSourceInventory(inventory)).toThrow(
        "not ready for the protocol v3 production cutover",
      );
    });
  }

  test("blocks every ambiguous legacy terminal and assistant projection", async () => {
    const database = createLegacyTerminalDatabase();
    database.execute(`
      INSERT INTO session VALUES ('session-1', 'partial-run', 3, 20, 'RUNNING', 'operation-1');
      INSERT INTO session_run VALUES
        (100, NULL, NULL, NULL, 'duplicate-run', 'session-1', 'completed', 'run.complete'),
        (100, NULL, NULL, NULL, 'mismatch-run', 'session-1', 'completed', 'run.complete'),
        (100, 'runtime.failed', '{}', 'Run failed', 'missing-run', 'session-1', 'failed', 'run.fail'),
        (NULL, 'runtime.failed', '{}', 'Run failed', 'partial-run', 'session-1', 'failed', 'run.complete'),
        (100, NULL, NULL, NULL, 'ambiguous-run', 'session-1', 'completed', 'run.complete'),
        (100, NULL, NULL, 'Run failed', 'invalid-error-run', 'session-1', 'failed', 'run.fail'),
        (100, 'stale.error', '{}', 'Stale error', 'invalid-nonfailed-error-run', 'session-1', 'completed', 'run.complete');
      INSERT INTO session_event VALUES
        ('duplicate-event-1', 'run.completed', 'duplicate-run', 1, 'session-1', 'session-run-terminal:duplicate-run:run.completed'),
        ('duplicate-event-2', 'run.completed', 'duplicate-run', 2, 'session-1', 'legacy-duplicate-source'),
        ('mismatch-event', 'run.failed', 'mismatch-run', 3, 'session-1', 'session-run-terminal:mismatch-run:run.failed'),
        ('partial-event', 'run.failed', 'partial-run', 4, 'session-1', 'session-run-terminal:partial-run:run.failed'),
        ('ambiguous-event', 'run.completed', 'ambiguous-run', 5, 'session-1', 'session-run-terminal:ambiguous-run:run.completed'),
        ('invalid-error-event', 'run.failed', 'invalid-error-run', 6, 'session-1', 'session-run-terminal:invalid-error-run:run.failed'),
        ('invalid-nonfailed-error-event', 'run.completed', 'invalid-nonfailed-error-run', 7, 'session-1', 'session-run-terminal:invalid-nonfailed-error-run:run.completed'),
        ('orphan-event', 'run.completed', 'unknown-run', 8, 'session-1', 'session-run-terminal:unknown-run:run.completed');
      INSERT INTO session_message VALUES
        ('partial-assistant', '[]', 'assistant', 1, '[]', 'session-1', 'partial-run'),
        ('ambiguous-assistant-1', '[]', 'assistant', 2, '[]', 'session-1', 'ambiguous-run'),
        ('ambiguous-assistant-2', '[]', 'assistant', 3, '[]', 'session-1', 'ambiguous-run');
      INSERT INTO session_permission_request VALUES ('partial-permission', 'partial-run', 'session-1');
      INSERT INTO driver_command VALUES ('accepted-command', 'accepted');
      INSERT INTO external_tool_effect VALUES ('claimed-effect', 'claimed');
    `);

    const integrity = await readLegacyTerminalIntegrity(database);
    expect(integrity).toMatchObject({
      ambiguousAssistantRuns: 1,
      duplicateTerminalRuns: 1,
      invalidFailedRuns: 1,
      invalidNonfailedRunErrors: 1,
      invalidTerminalLinks: 1,
      mismatchedTerminalEvents: 1,
      missingTerminalEvents: 1,
      noncanonicalTerminalSources: 1,
      nonterminalCommands: 1,
      partialAssistantProjections: 1,
      partialTerminalProjections: 1,
      unsettledEffects: 1,
    });
    expect(() => assertProtocolV3LegacyTerminalIntegrity(integrity)).toThrow(
      "Legacy terminal integrity is ambiguous",
    );
  });

  for (const fixture of [
    {
      blocker: "partialTerminalProjections",
      label: "a terminal event beyond the Session cursor",
      mutate: "UPDATE session SET runtime_event_seq_cursor = 0 WHERE id = 'session-1'",
    },
    {
      blocker: "partialAssistantProjections",
      label: "a materialized assistant beyond the Session cursor",
      mutate: "UPDATE session SET message_seq_cursor = 0 WHERE id = 'session-1'",
    },
    {
      blocker: "partialTerminalProjections",
      label: "a terminal Run with a permission request",
      mutate:
        "INSERT INTO session_permission_request VALUES ('permission-1', 'completed-run', 'session-1')",
    },
    {
      blocker: "partialTerminalProjections",
      label: "a current terminal Run whose Session remains live",
      mutate: "UPDATE session SET status = 'RUNNING' WHERE id = 'session-1'",
    },
    {
      blocker: "partialTerminalProjections",
      label: "a current terminal Run whose Session keeps an operation fence",
      mutate: "UPDATE session SET status_operation_id = 'operation-1' WHERE id = 'session-1'",
    },
    {
      blocker: "partialTerminalProjections",
      label: "a terminal Run without a completion timestamp",
      mutate: "UPDATE session_run SET completed_at = NULL WHERE id = 'completed-run'",
    },
    {
      blocker: "partialTerminalProjections",
      label: "a terminal Run with the wrong lifecycle event",
      mutate: "UPDATE session_run SET status_event = 'run.fail' WHERE id = 'completed-run'",
    },
  ] as const) {
    test(`blocks ${fixture.label} before migration 0015`, async () => {
      const database = createValidLegacyCompletionDatabase();
      database.execute(fixture.mutate);

      const integrity = await readLegacyTerminalIntegrity(database);
      expect(integrity[fixture.blocker]).toBe(1);
      expect(() => assertProtocolV3LegacyTerminalIntegrity(integrity)).toThrow(
        "Legacy terminal integrity is ambiguous",
      );
    });
  }

  test("keeps the recovery bookmark in the one-shot D1 gate", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENTER_PROTOCOL_V3_DRAIN_SQL);

    const bookmark = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
    expect(parseTimeTravelBookmark(JSON.stringify({ bookmark }))).toBe(bookmark);
    database.execute(storeProtocolV3CutoverBookmarkSql(bookmark));

    const stored = await database
      .prepare(
        'SELECT pre_migration_bookmark AS bookmark FROM "__protocol_v3_cutover" WHERE id = 1',
      )
      .first<{ bookmark: string }>();
    expect(parseStoredProtocolV3CutoverBookmark(d1Json(stored))).toBe(bookmark);

    const sessionId = "01J0000000000000000000000A";
    const requestKey = "protocol-v3-cutover-2de67417-f144-47e1-8b2e-1e71621a0d92";
    database.execute(storeProtocolV3SmokeRequestKeySql(requestKey));
    const storedRequestKey = await database
      .prepare(PROTOCOL_V3_SMOKE_REQUEST_KEY_SQL)
      .first<Record<string, unknown>>();
    expect(parseStoredProtocolV3SmokeRequestKey(d1Json(storedRequestKey))).toBe(requestKey);
    database.execute(storeProtocolV3SmokeSessionSql(sessionId));
    const storedSession = await database
      .prepare(PROTOCOL_V3_SMOKE_SESSION_SQL)
      .first<Record<string, unknown>>();
    expect(parseStoredProtocolV3SmokeSession(d1Json(storedSession))).toBe(sessionId);
  });

  test("persists migration intent before the remote apply can outlive this process", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);

    database.execute(beginProtocolV3MigrationSql(RELEASE_TREE_OID));
    expect((await readCutoverState(database)).migrationStarted).toBe(false);

    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(beginProtocolV3MigrationSql(RELEASE_TREE_OID));
    expect(await readCutoverState(database)).toMatchObject({
      enabled: true,
      migrationStarted: true,
    });

    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    expect((await readCutoverState(database)).migrationStarted).toBe(true);
  });

  test("requires exact trigger-free migration intent authority", async () => {
    for (const mutate of [
      (database: SqliteD1Database) =>
        database.execute(`
          DROP TABLE "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}";
          CREATE TABLE "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}" (
            id integer PRIMARY KEY,
            started_at integer NOT NULL
          );
        `),
      (database: SqliteD1Database) =>
        database.execute(`
          CREATE TRIGGER migration_intent_spoof
          AFTER INSERT ON "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}"
          BEGIN
            SELECT 1;
          END;
        `),
    ]) {
      const database = createCutoverGateDatabase();
      database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
      mutate(database);
      await expect(readCutoverState(database)).rejects.toThrow(
        "migration intent authority is invalid",
      );
    }
  });

  test("treats an isolated migration intent table as incomplete gate cleanup", async () => {
    const database = new SqliteD1Database();
    database.execute(`CREATE TABLE "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}" (id integer)`);
    const probe = await database
      .prepare(PROTOCOL_V3_CUTOVER_PROBE_SQL)
      .first<Record<string, unknown>>();
    expect(parseProtocolV3CutoverProbe(d1Json(probe))).toEqual({ gatePresent: true });
  });

  test("keeps a durable marker until queue resume survives a restart", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL);

    const readState = async () =>
      parseProtocolV3CutoverState(
        d1Json(
          await database.prepare(PROTOCOL_V3_COMMAND_FREEZE_SQL).first<Record<string, unknown>>(),
        ),
      );
    expect(await readState()).toEqual({
      commandFreeze: true,
      ...EMPTY_ROLLOUT,
      enabled: true,
      phase: "queues_resuming",
    });

    await expect(
      database
        .prepare(
          "INSERT INTO session_run VALUES ('v3-run', 'queued', '01J00000000000000000000001', 'session-1')",
        )
        .run(),
    ).rejects.toThrow("protocol v3 cutover blocks new active Session Runs");

    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    expect(await readState()).toEqual({
      commandFreeze: true,
      ...EMPTY_ROLLOUT,
      enabled: true,
      phase: "queues_resuming",
    });

    database.execute(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
    expect(await readState()).toEqual({
      commandFreeze: true,
      ...EMPTY_ROLLOUT,
      enabled: false,
      phase: "queues_resuming",
    });
    await expect(
      database
        .prepare("INSERT INTO session_run VALUES ('v3-run', 'queued', 'account-1', 'session-1')")
        .run(),
    ).resolves.toBeDefined();

    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
    });

    database.execute(DROP_PROTOCOL_V3_CUTOVER_TRIGGERS_SQL);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: 1,
    });
    await expect(
      database
        .prepare(
          "INSERT INTO session_run VALUES ('cleanup-interrupted', 'queued', '01J00000000000000000000001', 'session-1')",
        )
        .run(),
    ).resolves.toBeDefined();

    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: 0,
    });
  });

  test("binds crash recovery to one clean Git tree and one rollout", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    const initial = await readCutoverState(database);
    expect(() => assertProtocolV3Release(initial, RELEASE_TREE_OID)).not.toThrow();

    const otherRelease = "89abcdef0123456789abcdef0123456789abcdef";
    database.execute(installProtocolV3CutoverSql(otherRelease));
    expect(() => assertProtocolV3Release(initial, otherRelease)).toThrow("belongs to release tree");

    const workerVersionId = "2de67417-f144-47e1-8b2e-1e71621a0d92";
    database.execute(
      storeProtocolV3RolloutSql(RELEASE_TREE_OID, workerVersionId, 17, CONTAINER_IMAGE_DIGEST),
    );
    database.execute(
      storeProtocolV3RolloutSql(RELEASE_TREE_OID, workerVersionId, 17, CONTAINER_IMAGE_DIGEST),
    );
    expect(await readCutoverState(database)).toEqual({
      commandFreeze: false,
      containerApplicationVersion: 17,
      containerImageDigest: CONTAINER_IMAGE_DIGEST,
      enabled: true,
      migrationStarted: false,
      phase: "draining",
      releaseTreeOid: RELEASE_TREE_OID,
      workerVersionId,
    });

    database.execute(
      storeProtocolV3RolloutSql(
        RELEASE_TREE_OID,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        18,
        "b".repeat(64),
      ),
    );
    expect((await readCutoverState(database)).workerVersionId).toBe(workerVersionId);
  });

  test("rejects dirty tracked, untracked, and submodule release trees", () => {
    expect(parseCleanGitTreeOid(`${RELEASE_TREE_OID}\n`, "")).toBe(RELEASE_TREE_OID);
    for (const status of [" M apps/api/src/index.ts", "?? untracked.ts", " m apps/driver"]) {
      expect(() => parseCleanGitTreeOid(RELEASE_TREE_OID, status)).toThrow("clean Git worktree");
    }
    for (const index of ["S apps/api/src/index.ts", "h apps/api/src/index.ts"]) {
      expect(() => parseCleanGitTreeOid(RELEASE_TREE_OID, "", index)).toThrow("clean Git worktree");
    }
    expect(() => parseCleanGitTreeOid(RELEASE_TREE_OID, "", "", "apps/web/.env.prod")).toThrow(
      "Vite build inputs",
    );
    expect(() =>
      parseCleanGitTreeOid(RELEASE_TREE_OID, "", "", "", ["PATH", "VITE_MOSOO_ENVIRONMENT"]),
    ).toThrow("Vite build inputs");
  });

  test("verifies the exact tagged Worker version before accepting rollout", () => {
    const versionId = "2de67417-f144-47e1-8b2e-1e71621a0d92";
    expect(
      parseProtocolV3WorkerDeployment(
        JSON.stringify({ versions: [{ percentage: 100, version_id: versionId }] }),
      ),
    ).toEqual({ versionId });
    expect(() =>
      assertProtocolV3WorkerVersion(
        JSON.stringify({
          annotations: { "workers/tag": `protocol-v3-${RELEASE_TREE_OID}` },
          id: versionId,
        }),
        versionId,
        RELEASE_TREE_OID,
      ),
    ).not.toThrow();
    expect(() =>
      assertProtocolV3WorkerVersion(
        JSON.stringify({ annotations: { "workers/tag": "protocol-v3-wrong" }, id: versionId }),
        versionId,
        RELEASE_TREE_OID,
      ),
    ).toThrow("not the exact protocol v3 release");

    const repository = "registry.cloudflare.com/account/mosoo-api-prod-sandbox-prod";
    expect(protocolV3ContainerImageTag(repository, versionId)).toBe(`${repository}:2de67417`);
    expect(
      parseProtocolV3ContainerManifestDigest(
        JSON.stringify({ Descriptor: { digest: `sha256:${CONTAINER_IMAGE_DIGEST}` } }),
      ),
    ).toBe(CONTAINER_IMAGE_DIGEST);
  });

  test("keeps admission closed when queue resume crashes partway and converges on retry", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL);
    const queues = [true, true, true];
    const actions: string[] = [];

    await expect(
      completeProtocolV3QueueResume(await readCutoverState(database), {
        commitAcceptance: () => {
          actions.push("commit");
          database.execute(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
        },
        removeMarker: () => {
          actions.push("remove");
          database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
        },
        resumeAndVerifyQueues: async () => {
          actions.push("resume-1");
          queues[0] = false;
          queues[1] = false;
          throw new Error("third queue readback failed");
        },
      }),
    ).rejects.toThrow("third queue readback failed");
    expect(actions).toEqual(["resume-1"]);
    expect(await readCutoverState(database)).toEqual({
      commandFreeze: true,
      ...EMPTY_ROLLOUT,
      enabled: true,
      phase: "queues_resuming",
    });

    await completeProtocolV3QueueResume(await readCutoverState(database), {
      commitAcceptance: () => {
        actions.push("commit");
        database.execute(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
      },
      removeMarker: () => {
        actions.push("remove");
        database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
      },
      resumeAndVerifyQueues: async () => {
        actions.push("resume-2");
        queues.fill(false);
      },
    });
    expect(actions).toEqual(["resume-1", "resume-2", "commit", "remove"]);
    expect(queues).toEqual([false, false, false]);
    expect(await readCutoverObjects(database)).toEqual({ exactObjectCount: 0, objectCount: 0 });
  });

  test("mutates and reads back every cutover Queue lane, then re-pauses all after failure", async () => {
    const paused = new Map(PROTOCOL_V3_CUTOVER_QUEUE_NAMES.map((name) => [name, true]));
    const calls: string[] = [];
    let staleReadback: string | null = null;
    const control = {
      list: async () => PROTOCOL_V3_CUTOVER_QUEUE_NAMES.map((name) => ({ id: `id:${name}`, name })),
      mutate: (queueName: string, action: "pause" | "resume") => {
        calls.push(`${action}:${queueName}`);
        paused.set(queueName, action === "pause");
      },
      read: async (queueId: string) => {
        const name = queueId.slice("id:".length);
        calls.push(`read:${name}`);
        const deliveryPaused = paused.get(name);
        if (deliveryPaused === undefined) throw new Error(`Unknown Queue ${name}.`);
        return {
          deliveryPaused: name === staleReadback ? !deliveryPaused : deliveryPaused,
          name,
        };
      },
    };

    await updateAndVerifyProtocolV3QueueDelivery(control, "resume");
    expect([...paused.entries()]).toEqual(
      PROTOCOL_V3_CUTOVER_QUEUE_NAMES.map((name) => [name, false]),
    );
    await updateAndVerifyProtocolV3QueueDelivery(control, "pause");
    expect([...paused.entries()]).toEqual(
      PROTOCOL_V3_CUTOVER_QUEUE_NAMES.map((name) => [name, true]),
    );

    staleReadback = "api-command-dlq";
    await expect(updateAndVerifyProtocolV3QueueDelivery(control, "resume")).rejects.toThrow(
      "Production queue resume and readback failed",
    );
    staleReadback = null;
    await updateAndVerifyProtocolV3QueueDelivery(control, "pause");
    expect([...paused.entries()]).toEqual(
      PROTOCOL_V3_CUTOVER_QUEUE_NAMES.map((name) => [name, true]),
    );
    for (const action of ["pause", "resume"] as const) {
      for (const name of PROTOCOL_V3_CUTOVER_QUEUE_NAMES) {
        expect(calls).toContain(`${action}:${name}`);
        expect(calls).toContain(`read:${name}`);
      }
    }
  });

  test("drains and re-pauses all three API command lanes before migration", async () => {
    const deploySource = await Bun.file(new URL("../bin/deploy-prod.ts", import.meta.url)).text();
    const drainStart = deploySource.indexOf("if (initialPendingMigrations.length > 0)");
    const migrationStart = deploySource.indexOf("if (durableMcpMigrationPending)", drainStart);
    const drainSource = deploySource.slice(drainStart, migrationStart);

    expect(drainSource).toContain("await resumeAndVerifyProdQueues(queueApiConfig);");
    expect(drainSource).toContain("await pauseAndVerifyProdQueues(queueApiConfig);");
    expect(drainSource).not.toContain('["api-command"]');
    expect(deploySource).toContain("let migrationStarted = true;");
    expect(
      deploySource.indexOf("cutoverState = beginProtocolV3Migration(", migrationStart),
    ).toBeLessThan(deploySource.indexOf("applyD1Migrations();", migrationStart));
    expect(
      deploySource.indexOf("authorizeProdLegacyTerminalRewrite(", migrationStart),
    ).toBeGreaterThan(
      deploySource.indexOf("cutoverState = beginProtocolV3Migration(", migrationStart),
    );
    expect(
      deploySource.indexOf("authorizeProdLegacyTerminalRewrite(", migrationStart),
    ).toBeLessThan(deploySource.indexOf("applyD1Migrations();", migrationStart));
  });

  test("recovers a lost acceptance acknowledgement and an externally re-paused queue", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL);
    const queues = [true, true, true];
    const actions: string[] = [];

    await expect(
      completeProtocolV3QueueResume(await readCutoverState(database), {
        commitAcceptance: () => {
          actions.push("commit-lost-ack");
          database.execute(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
          throw new Error("acceptance readback unavailable");
        },
        removeMarker: () => {
          actions.push("remove");
          database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
        },
        resumeAndVerifyQueues: async () => {
          actions.push("resume-1");
          queues.fill(false);
        },
      }),
    ).rejects.toThrow("acceptance readback unavailable");
    expect(await readCutoverState(database)).toEqual({
      commandFreeze: true,
      ...EMPTY_ROLLOUT,
      enabled: false,
      phase: "queues_resuming",
    });

    queues[1] = true;
    await completeProtocolV3QueueResume(await readCutoverState(database), {
      commitAcceptance: () => actions.push("unexpected-recommit"),
      removeMarker: () => {
        actions.push("remove");
        database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
      },
      resumeAndVerifyQueues: async () => {
        actions.push("resume-2");
        queues.fill(false);
      },
    });
    expect(actions).toEqual(["resume-1", "commit-lost-ack", "resume-2", "remove"]);
    expect(queues).toEqual([false, false, false]);
    expect(await readCutoverObjects(database)).toEqual({ exactObjectCount: 0, objectCount: 0 });
  });

  for (const spoof of [
    {
      label: "a WHEN 0 trigger",
      name: "__protocol_v3_cutover_session_run_insert",
    },
    {
      label: "a differently-cased reserved trigger",
      name: "__PROTOCOL_V3_CUTOVER_SESSION_RUN_INSERT",
    },
  ]) {
    test(`fails exact gate verification for ${spoof.label}`, async () => {
      const database = createCutoverGateDatabase();
      database.execute(`
        CREATE TRIGGER "${spoof.name}"
        BEFORE INSERT ON "session_run"
        WHEN 0
        BEGIN
          SELECT 1;
        END;
      `);

      database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
      expect(await readCutoverObjects(database)).toEqual({
        exactObjectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT - 1,
        objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
      });
      await expect(
        database
          .prepare(
            "INSERT INTO session_run VALUES ('spoof-run', 'queued', 'account-1', 'session-1')",
          )
          .run(),
      ).resolves.toBeDefined();

      const probe = await database
        .prepare(PROTOCOL_V3_CUTOVER_PROBE_SQL)
        .first<Record<string, unknown>>();
      expect(parseProtocolV3CutoverProbe(d1Json(probe)).gatePresent).toBe(true);
    });
  }

  test("rejects an extra trigger attached to a protected admission table", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(`
      CREATE TRIGGER disable_protocol_v3_gate
      BEFORE INSERT ON "session_run"
      BEGIN
        UPDATE "__protocol_v3_cutover"
        SET "command_freeze" = 1, "enabled" = 0, "phase" = 'queues_resuming'
        WHERE "id" = 1;
      END
    `);

    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT + 1,
    });
    await expect(
      database
        .prepare("INSERT INTO session_run VALUES ('spoof-run', 'queued', 'account-1', 'session-1')")
        .run(),
    ).resolves.toBeDefined();
    const probe = await database
      .prepare(PROTOCOL_V3_CUTOVER_PROBE_SQL)
      .first<Record<string, unknown>>();
    expect(parseProtocolV3CutoverProbe(d1Json(probe)).gatePresent).toBe(true);
  });

  test("excludes only the exact permanent sandbox identity trigger", async () => {
    const database = createCutoverGateDatabase();
    database.execute(`
      ALTER TABLE sandbox ADD kind text;
      ALTER TABLE sandbox ADD agent_id text;
      ALTER TABLE sandbox ADD project_id text;
      ALTER TABLE sandbox ADD owner_account_id text;
    `);
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    const managed = MANAGED_PROD_SCHEMA_TRIGGERS.find(
      (trigger) => trigger.name === "sandbox_identity_immutable",
    );
    if (managed === undefined) throw new Error("Sandbox identity trigger fixture is missing.");
    database.execute(managed.sql);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
    });

    database.execute(`
      DROP TRIGGER sandbox_identity_immutable;
      CREATE TRIGGER sandbox_identity_immutable
      BEFORE INSERT ON sandbox WHEN 0
      BEGIN
        SELECT 1;
      END;
    `);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT + 1,
    });
  });

  test("excludes only the exact permanent environment staging triggers", async () => {
    const database = createCutoverGateDatabase();
    addPostRuntimeAuthoritySchema(database);
    database.execute(INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL);
    for (const name of [
      "environment_package_artifact_backup_staging_authority",
      "environment_package_artifact_backup_staging_immutable",
    ]) {
      const managed = MANAGED_PROD_SCHEMA_TRIGGERS.find((trigger) => trigger.name === name);
      if (managed === undefined) throw new Error(`Managed trigger ${name} fixture is missing.`);
      database.execute(managed.sql);
    }
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });

    database.execute(`
      DROP TRIGGER environment_package_artifact_backup_staging_authority;
      CREATE TRIGGER environment_package_artifact_backup_staging_authority
      BEFORE INSERT ON environment_package_artifact_backup_staging WHEN 0
      BEGIN
        SELECT 1;
      END;
    `);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT + 1,
    });
  });

  test("does not exempt a same-name spoof of the rewrite revocation trigger", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(`
      CREATE TRIGGER "__protocol_v3_legacy_rewrite_gate_update"
      BEFORE INSERT ON "session_run"
      BEGIN
        UPDATE "__protocol_v3_cutover"
        SET "command_freeze" = 1, "enabled" = 0, "phase" = 'queues_resuming'
        WHERE "id" = 1;
      END
    `);

    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT + 1,
    });
    await expect(
      database
        .prepare(
          "INSERT INTO session_run VALUES ('auth-spoof-run', 'queued', 'account-1', 'session-1')",
        )
        .run(),
    ).resolves.toBeDefined();
  });

  test("detects a same-name object from another sqlite namespace through cleanup", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(`
      DROP TRIGGER "__protocol_v3_cutover_session_run_insert";
      CREATE VIEW "__protocol_v3_cutover_session_run_insert" AS SELECT 1 AS value;
    `);

    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT + 1,
    });

    database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    expect(await readCutoverObjects(database)).toEqual({
      exactObjectCount: 0,
      objectCount: 1,
    });
  });

  test("retries accepted queue verification and idempotent marker cleanup without re-pausing", async () => {
    const database = createCutoverGateDatabase();
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL);
    database.execute(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
    database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    const calls: string[] = [];
    const originalError = new Error("marker deletion committed before its readback failed");
    const state = {
      bookmark: null,
      initialPendingMigrations: [],
      migrationStarted: false,
      originalError,
      queuesVerified: true,
    };
    await expect(
      recoverProtocolV3CutoverFailure(state, {
        commitQueueAcceptance: () => calls.push("unexpected-commit"),
        pauseAndVerifyQueues: async () => calls.push("unexpected-pause"),
        printBookmark: () => calls.push("unexpected-bookmark"),
        probe: () => {
          calls.push("probe");
          return parseProtocolV3CutoverProbe(
            d1Json({
              gate_present: 0,
            }),
          );
        },
        readBookmark: () => null,
        readPendingMigrations: () => [],
        removeMarker: () => calls.push("unexpected-remove"),
        resumeAndVerifyQueues: async () => calls.push("resume"),
        write: () => {},
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["resume", "probe"]);
    expect(await readCutoverObjects(database)).toEqual({ exactObjectCount: 0, objectCount: 0 });
  });

  test("keeps production closed when an unacknowledged migration commits after recovery starts", async () => {
    const database = createCutoverGateDatabase();
    const migration = "0020_runtime-subject-operation-authority.sql";
    database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
    database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
    database.execute(beginProtocolV3MigrationSql(RELEASE_TREE_OID));
    const calls: string[] = [];
    const messages: string[] = [];
    const originalError = new Error("migration apply acknowledgement timed out");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: "emergency-bookmark",
          initialPendingMigrations: [migration],
          migrationStarted: (await readCutoverState(database)).migrationStarted,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => calls.push("unexpected-commit"),
          pauseAndVerifyQueues: async () => {
            calls.push("pause");
            database.execute(`INSERT INTO d1_migrations VALUES ('${migration}')`);
          },
          printBookmark: () => calls.push("bookmark"),
          probe: () => ({ gatePresent: true }),
          readBookmark: () => null,
          readPendingMigrations: () => {
            calls.push("unexpected-read-pending");
            return [migration];
          },
          removeMarker: () => calls.push("unexpected-remove"),
          resumeAndVerifyQueues: async () => calls.push("unexpected-resume"),
          write: (message) => messages.push(message),
        },
      ),
    ).rejects.toThrow(originalError.message);

    expect(calls).toEqual(["pause", "bookmark"]);
    expect(messages.join("\n")).toContain("migration request may have committed");
    expect(await readCutoverState(database)).toMatchObject({
      enabled: true,
      migrationStarted: true,
    });
    expect(
      await database.prepare("SELECT name FROM d1_migrations").first<{ name: string }>(),
    ).toEqual({ name: migration });
  });

  test("keeps a gate-missing pre-acceptance failure closed after probing", async () => {
    const infrastructureCalls: string[] = [];
    const messages: string[] = [];
    const originalError = new Error("cutover failed before queue acceptance");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: "emergency-bookmark",
          initialPendingMigrations: ["0020_runtime-subject-operation-authority.sql"],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => {
            infrastructureCalls.push("commit");
          },
          pauseAndVerifyQueues: async () => {
            infrastructureCalls.push("pause");
          },
          printBookmark: () => {},
          probe: () => {
            infrastructureCalls.push("probe");
            return {
              gatePresent: false,
            };
          },
          readBookmark: () => {
            infrastructureCalls.push("read-bookmark");
            return null;
          },
          readPendingMigrations: () => {
            infrastructureCalls.push("read-pending");
            return [];
          },
          removeMarker: () => {
            infrastructureCalls.push("remove");
          },
          resumeAndVerifyQueues: async () => {
            infrastructureCalls.push("resume-and-verify");
          },
          write: (message) => messages.push(message),
        },
      ),
    ).rejects.toThrow(originalError.message);

    expect(infrastructureCalls).toEqual(["read-pending", "pause"]);
    expect(messages.join("\n")).toContain("rolling forward this exact v3 release");
    expect(messages.join("\n")).not.toContain("manually resume");
  });

  test("keeps queues closed when Worker publication fails its exact readback", async () => {
    const calls: string[] = [];
    const originalError = new Error("published Worker configuration is not exact");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: null,
          initialPendingMigrations: [],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => calls.push("unexpected-commit"),
          pauseAndVerifyQueues: async () => calls.push("pause-and-verify"),
          printBookmark: () => calls.push("unexpected-bookmark"),
          probe: () => {
            calls.push("unexpected-probe");
            return { gatePresent: true };
          },
          readBookmark: () => null,
          readPendingMigrations: () => {
            calls.push("unexpected-read-pending");
            return [];
          },
          removeMarker: () => calls.push("unexpected-remove"),
          resumeAndVerifyQueues: async () => calls.push("unexpected-resume"),
          write: () => {},
        },
      ),
    ).rejects.toThrow(originalError.message);
    expect(calls).toEqual(["pause-and-verify"]);
  });

  test("restores the old service when legacy preflight fails before protocol migration", async () => {
    const infrastructureCalls: string[] = [];
    const originalError = new Error("Legacy terminal integrity is ambiguous");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: null,
          initialPendingMigrations: [
            "0014_durable-mcp-effect-v3.sql",
            "0015_session-event-stream-identity.sql",
          ],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => {
            infrastructureCalls.push("commit");
          },
          pauseAndVerifyQueues: async () => {
            infrastructureCalls.push("pause");
          },
          printBookmark: () => {
            infrastructureCalls.push("print-bookmark");
          },
          probe: () => {
            infrastructureCalls.push("probe");
            return {
              gatePresent: true,
            };
          },
          readBookmark: () => {
            infrastructureCalls.push("read-bookmark");
            return null;
          },
          readPendingMigrations: () => {
            infrastructureCalls.push("read-pending");
            return ["0014_durable-mcp-effect-v3.sql", "0015_session-event-stream-identity.sql"];
          },
          removeMarker: () => {
            infrastructureCalls.push("remove");
          },
          resumeAndVerifyQueues: async () => {
            infrastructureCalls.push("resume-and-verify");
          },
          write: () => {},
        },
      ),
    ).rejects.toThrow(originalError.message);

    expect(infrastructureCalls).toEqual(["read-pending", "resume-and-verify", "remove"]);
  });

  test("keeps old admission closed until every queue is verifiably resumed", async () => {
    const calls: string[] = [];
    const queues = [true, true, true];
    const originalError = new Error("legacy preflight failed");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: null,
          initialPendingMigrations: ["0020_runtime-subject-operation-authority.sql"],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => calls.push("commit"),
          pauseAndVerifyQueues: async () => {
            calls.push("pause-and-verify");
            queues.fill(true);
            expect(queues).toEqual([true, true, true]);
          },
          printBookmark: () => {},
          probe: () => ({
            gatePresent: true,
          }),
          readBookmark: () => null,
          readPendingMigrations: () => {
            calls.push("read-pending");
            return ["0020_runtime-subject-operation-authority.sql"];
          },
          removeMarker: () => calls.push("remove"),
          resumeAndVerifyQueues: async () => {
            calls.push("verify");
            queues[0] = false;
            throw new Error("queue 2 remains paused");
          },
          write: () => {},
        },
      ),
    ).rejects.toThrow(originalError.message);
    expect(calls).toEqual(["read-pending", "verify", "pause-and-verify"]);
    expect(queues).toEqual([true, true, true]);
  });

  test("re-pauses every queue when marker cleanup and its readback both fail", async () => {
    const calls: string[] = [];
    const originalError = new Error("pre-migration deploy failed");
    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: null,
          initialPendingMigrations: ["0020_runtime-subject-operation-authority.sql"],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => calls.push("unexpected-commit"),
          pauseAndVerifyQueues: async () => calls.push("pause-and-verify"),
          printBookmark: () => calls.push("unexpected-bookmark"),
          probe: () => {
            calls.push("probe");
            throw new Error("D1 marker readback failed");
          },
          readBookmark: () => null,
          readPendingMigrations: () => {
            calls.push("read-pending");
            return ["0020_runtime-subject-operation-authority.sql"];
          },
          removeMarker: () => {
            calls.push("remove");
            throw new Error("marker delete acknowledgement lost");
          },
          resumeAndVerifyQueues: async () => calls.push("resume-and-verify"),
          write: () => {},
        },
      ),
    ).rejects.toThrow(originalError.message);
    expect(calls).toEqual([
      "read-pending",
      "resume-and-verify",
      "remove",
      "pause-and-verify",
      "probe",
    ]);
  });

  test("re-pauses every queue when gate-absent old-service resume is only partial", async () => {
    const calls: string[] = [];
    const queues = [true, true, true];
    let resumeAttempts = 0;
    const originalError = new Error("pre-migration deploy failed");

    await expect(
      recoverProtocolV3CutoverFailure(
        {
          bookmark: null,
          initialPendingMigrations: ["0020_runtime-subject-operation-authority.sql"],
          migrationStarted: false,
          originalError,
          queuesVerified: false,
        },
        {
          commitQueueAcceptance: () => calls.push("unexpected-commit"),
          pauseAndVerifyQueues: async () => {
            calls.push("pause-and-verify");
            queues.fill(true);
          },
          printBookmark: () => calls.push("unexpected-bookmark"),
          probe: () => {
            calls.push("probe");
            return { gatePresent: false };
          },
          readBookmark: () => null,
          readPendingMigrations: () => {
            calls.push("read-pending");
            return ["0020_runtime-subject-operation-authority.sql"];
          },
          removeMarker: () => {
            calls.push("remove");
            throw new Error("marker delete acknowledgement lost");
          },
          resumeAndVerifyQueues: async () => {
            calls.push("resume-and-verify");
            resumeAttempts += 1;
            if (resumeAttempts === 1) {
              queues.fill(false);
              return;
            }
            queues[0] = false;
            throw new Error("queue resume was partial");
          },
          write: () => {},
        },
      ),
    ).rejects.toThrow(originalError.message);

    expect(calls).toEqual([
      "read-pending",
      "resume-and-verify",
      "remove",
      "pause-and-verify",
      "probe",
      "resume-and-verify",
      "pause-and-verify",
    ]);
    expect(queues).toEqual([true, true, true]);
  });

  test("requires the live smoke Driver to complete protocol v3 hello and ready", () => {
    const ready = parseProtocolV3SmokeStatus(
      d1Json({
        boot_token_used_at: 1_787_942_399_000,
        connection_id: "connection-1",
        driver_pid: 42,
        driver_started_at: 1_787_942_400_000,
        driver_status: "ready",
        driver_version: "3.0.0",
        protocol_version: 3,
        status_event: "driver.ready",
      }),
    );
    expect(isProtocolV3SmokeReady(ready)).toBeTrue();
    expect(isProtocolV3SmokeReady({ ...ready, driverPid: null })).toBeFalse();
    expect(isProtocolV3SmokeReady({ ...ready, connectionId: null })).toBeFalse();
    expect(isProtocolV3SmokeReady({ ...ready, driverStatus: "connecting" })).toBeFalse();
    expect(isProtocolV3SmokeReady({ ...ready, protocolVersion: 2 })).toBeFalse();
    expect(protocolV3SmokeStatusSql("01J0000000000000000000000A")).toContain(
      '"latest"."driver_started_at"',
    );
  });

  test("requires a published cattle Agent for the production smoke", async () => {
    const database = new SqliteD1Database();
    const agentId = "01J0000000000000000000000A";
    database.execute(`
      CREATE TABLE agent (id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL);
      INSERT INTO agent VALUES ('${agentId}', 'pet', 'published');
    `);
    const readAgent = async () => {
      const row = await database
        .prepare(protocolV3SmokeAgentSql(agentId))
        .first<Record<string, unknown>>();
      if (row === null) throw new Error("Smoke Agent query returned no row.");
      return d1Json(row);
    };

    let raw = await readAgent();
    expect(() => assertProtocolV3SmokeAgent(raw)).toThrow("published cattle Agent");
    database.execute(`UPDATE agent SET kind = 'cattle', status = 'draft'`);
    raw = await readAgent();
    expect(() => assertProtocolV3SmokeAgent(raw)).toThrow("published cattle Agent");
    database.execute(`UPDATE agent SET status = 'published'`);
    raw = await readAgent();
    expect(() => assertProtocolV3SmokeAgent(raw)).not.toThrow();
  });

  test("rejects an old Container version found only on a later page", async () => {
    const requestedPages: Array<string | null> = [];
    const instances = await collectProtocolV3ContainerInstances((pageToken) => {
      requestedPages.push(pageToken);
      return pageToken === null
        ? containerPage([{ state: "running", version: 3 }], null, "page-2")
        : containerPage([{ state: "running", version: 2 }], "page-2", null);
    });

    expect(requestedPages).toEqual([null, "page-2"]);
    expect(instances).toHaveLength(2);
    expect(
      isProtocolV3ContainerRolloutConverged({ state: "ready", version: 3 }, instances),
    ).toBeFalse();
    expect(
      isProtocolV3ContainerRolloutConverged({ state: "unknown", version: 3 }, [
        { state: "running", version: 3 },
      ]),
    ).toBeFalse();
  });

  test("accepts an exact scale-to-zero Container application with no old instances", async () => {
    const [application] = await collectProtocolV3ContainerApplications(() =>
      containerApplicationPage(
        [
          {
            ...containerApplication("mosoo-api-prod-sandbox-prod", 3),
            health: {
              instances: { active: 0, failed: 0, healthy: 0, scheduling: 0, starting: 0 },
            },
          },
        ],
        null,
        null,
      ),
    );
    const instances = await collectProtocolV3ContainerInstances(() =>
      containerPage([], null, null),
    );
    if (application === undefined) throw new Error("Container application fixture is missing.");

    expect(application.state).toBe("ready");
    expect(isProtocolV3ContainerRolloutConverged(application, instances)).toBeTrue();
  });

  test.each(["degraded", "provisioning", "unknown"])(
    "does not accept an empty %s Container application as converged",
    (state) => {
      expect(isProtocolV3ContainerRolloutConverged({ state, version: 3 }, [])).toBeFalse();
    },
  );

  test.each(["active", "ready"])(
    "accepts an empty exact %s Container application as converged",
    (state) => {
      expect(isProtocolV3ContainerRolloutConverged({ state, version: 3 }, [])).toBeTrue();
    },
  );

  test("finds the production Container application on a later page", async () => {
    const requestedPages: Array<string | null> = [];
    const applications = await collectProtocolV3ContainerApplications((pageToken) => {
      requestedPages.push(pageToken);
      return pageToken === null
        ? containerApplicationPage([containerApplication("other-app", 3)], null, "page-2")
        : containerApplicationPage(
            [containerApplication("mosoo-api-prod-sandbox-prod", 3)],
            "page-2",
            null,
          );
    });

    expect(requestedPages).toEqual([null, "page-2"]);
    expect(applications.map(({ name }) => name)).toEqual([
      "other-app",
      "mosoo-api-prod-sandbox-prod",
    ]);
  });

  registerPaginationFailureTests({
    collect: collectProtocolV3ContainerApplications,
    invalidMessage: "valid opaque token",
    invalidPage: { result: [], result_info: { page_token: null }, success: true },
    label: "Container application",
    page: (pageToken, nextPageToken) => containerApplicationPage([], pageToken, nextPageToken),
  });

  registerPaginationFailureTests({
    collect: collectProtocolV3ContainerInstances,
    invalidMessage: "paginated object",
    invalidPage: "[]",
    label: "Container instance",
    page: (pageToken, nextPageToken) => containerPage([], pageToken, nextPageToken),
  });
});
