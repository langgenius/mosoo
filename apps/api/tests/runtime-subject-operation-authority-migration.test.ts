import { describe, expect, test } from "bun:test";

import {
  installProtocolV3CutoverSql,
  INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL,
  PROTOCOL_V3_CUTOVER_OBJECTS_SQL,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
  REMOVE_PROTOCOL_V3_CUTOVER_SQL,
} from "../bin/protocol-v3-cutover";
import { applyDrizzleMigration, applyDrizzleMigrationsBefore } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MIGRATION_TAG = "0020_runtime-subject-operation-authority";
const id = (suffix: string) => `01J0000000000000000000001${suffix}`;

const ACCOUNT_ID = id("A");
const PROJECT_ID = id("B");
const PET_AGENT_ID = id("C");
const CATTLE_AGENT_ID = id("D");
const PET_SESSION_ID = id("E");
const CATTLE_SESSION_ID = id("F");
const PET_SANDBOX_ID = id("G");
const CATTLE_SANDBOX_ID = id("H");
const PET_CLOUDFLARE_SESSION_ID = id("J");
const CATTLE_CLOUDFLARE_SESSION_ID = id("K");
const RUN_ID = id("M");
const DRIVER_ID = id("N");
const DRIVER_COMMAND_ID = id("P");
const EFFECT_ID = id("Q");
const SERVER_ID = id("R");
const API_COMMAND_ID = id("S");
const PET_BACKUP_ID = id("T");
const CATTLE_BACKUP_ID = id("V");
const PRUNED_BACKUP_ID = id("W");
const OPERATION_ID = id("X");
const DEPLOYMENT_ID = id("5");

function createLegacyDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsBefore(database, MIGRATION_TAG);
  database.execute(`
    INSERT INTO project (
      created_at, id, name, organization_id, owner_account_id, updated_at
    ) VALUES (1, '${PROJECT_ID}', 'Fixture', '${ACCOUNT_ID}', '${ACCOUNT_ID}', 1);

    INSERT INTO agent (
      config_json, created_at, id, kind, model, name, owner_account_id,
      project_id, prompt, provider, runtime_id, status, updated_at, visibility
    ) VALUES
      ('{}', 1, '${PET_AGENT_ID}', 'pet', 'gpt-5.4', 'Pet', '${ACCOUNT_ID}',
       '${PROJECT_ID}', '', 'openai', 'codex', 'draft', 1, 'private'),
      ('{}', 1, '${CATTLE_AGENT_ID}', 'cattle', 'gpt-5.4', 'Cattle', '${ACCOUNT_ID}',
       '${PROJECT_ID}', '', 'openai', 'codex', 'draft', 1, 'private');

    INSERT INTO session (
      agent_id, created_at, creator_account_id, id, kind, model, project_id,
      provider, renamed, runtime_id, status, updated_at
    ) VALUES
      ('${PET_AGENT_ID}', 1, '${ACCOUNT_ID}', '${PET_SESSION_ID}', 'pet', 'gpt-5.4',
       '${PROJECT_ID}', 'openai', 0, 'codex', 'IDLE', 1),
      ('${CATTLE_AGENT_ID}', 1, '${ACCOUNT_ID}', '${CATTLE_SESSION_ID}', 'cattle',
       'gpt-5.4', '${PROJECT_ID}', 'openai', 0, 'codex', 'IDLE', 1);

    INSERT INTO sandbox (
      agent_id, project_id, created_at, id, kind, owner_account_id, status,
      subject_id, subject_kind, updated_at
    ) VALUES
      (NULL, NULL, 1, '${PET_SANDBOX_ID}', 'pet', NULL, 'cold',
       '${PET_AGENT_ID}', 'agent', 1),
      ('${CATTLE_AGENT_ID}', '${PROJECT_ID}', 1, '${CATTLE_SANDBOX_ID}', 'cattle',
       '${ACCOUNT_ID}', 'cold', '${CATTLE_SESSION_ID}', 'session', 1);

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      session_id, status, updated_at
    ) VALUES
      ('${PET_CLOUDFLARE_SESSION_ID}', 1, '/workspace', '{}', '${PET_SANDBOX_ID}',
       '${PET_SESSION_ID}', 'closed', 1),
      ('${CATTLE_CLOUDFLARE_SESSION_ID}', 1, '/workspace', '{}',
       '${CATTLE_SANDBOX_ID}', '${CATTLE_SESSION_ID}', 'error', 1);

    INSERT INTO session_run (
      agent_id, completed_at, created_at, created_by_account_id, id, session_id,
      status, status_event, trace_id, trigger, updated_at
    ) VALUES (
      '${CATTLE_AGENT_ID}', 2, 1, '${ACCOUNT_ID}', '${RUN_ID}', '${CATTLE_SESSION_ID}',
      'completed', 'run.complete', 'trace', 'user', 2
    );

    INSERT INTO driver_instance (
      boot_token_expires_at, boot_token_hash, created_at, expires_at,
      generation, heartbeat_count, id, protocol, protocol_version, runtime,
      sandbox_id, sandbox_session_id, status, updated_at
    ) VALUES (
      10, x'01', 1, 10, 7, 0, '${DRIVER_ID}', 'rpc', 2, 'openai-runtime',
      '${CATTLE_SANDBOX_ID}', '${CATTLE_SESSION_ID}', 'failed', 2
    );

    INSERT INTO driver_command (
      driver_instance_id, id, issued_at, kind, payload_json, seq, status
    ) VALUES ('${DRIVER_ID}', '${DRIVER_COMMAND_ID}', 1, 'session.stop', '{}', 1, 'completed');

    INSERT INTO external_tool_effect (
      command_id, created_at, driver_instance_id, id, idempotency_key, server_id,
      session_run_id, status, tool_name, updated_at
    ) VALUES (
      '${DRIVER_COMMAND_ID}', 1, '${DRIVER_ID}', '${EFFECT_ID}', 'fixture-effect',
      '${SERVER_ID}', '${RUN_ID}', 'succeeded', 'write', 2
    );

    INSERT INTO api_command (
      created_at, dedupe_key, id, kind, payload_json, status, updated_at
    ) VALUES (1, 'fixture-command', '${API_COMMAND_ID}', 'scheduled_maintenance', '{}',
              'succeeded', 2);

    INSERT INTO sandbox_backup (
      created_at, dir, id, keep, sandbox_id, session_run_id, status, ttl_seconds,
      updated_at
    ) VALUES
      (1, '/pet', '${PET_BACKUP_ID}', 1, '${PET_SANDBOX_ID}', NULL, 'ready', 60, 2),
      (1, '/workspace', '${CATTLE_BACKUP_ID}', 0, '${CATTLE_SANDBOX_ID}',
       '${RUN_ID}', 'ready', 60, 2),
      (1, '/archive', '${PRUNED_BACKUP_ID}', 0, '${CATTLE_SANDBOX_ID}', NULL,
       'pruned', 60, 2);

    UPDATE sandbox
    SET last_backup_id = '${PET_BACKUP_ID}'
    WHERE id = '${PET_SANDBOX_ID}';

    UPDATE sandbox
    SET last_backup_id = '${CATTLE_BACKUP_ID}',
        last_restore_backup_id = '${PRUNED_BACKUP_ID}'
    WHERE id = '${CATTLE_SANDBOX_ID}';
  `);
  return database;
}

async function columnNames(database: SqliteD1Database, table: string): Promise<string[]> {
  const result = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return result.results.map(({ name }) => name);
}

async function cutoverCatalog(database: SqliteD1Database) {
  return (
    await database
      .prepare(
        `SELECT name, sql, tbl_name, type
         FROM sqlite_master
         WHERE name = '__protocol_v3_cutover'
            OR name GLOB '__protocol_v3_cutover_*'
         ORDER BY type, name`,
      )
      .all()
  ).results;
}

describe("0020 runtime subject operation authority migration", () => {
  test("backfills authoritative identity and preserves only durable backup lineage", async () => {
    const database = createLegacyDatabase();

    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(
      await database
        .prepare(
          `SELECT id, agent_id, project_id, owner_account_id, incarnation,
                  network_constraints_hash, operation_kind, status_operation_id
           FROM sandbox ORDER BY id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          agent_id: PET_AGENT_ID,
          project_id: PROJECT_ID,
          id: PET_SANDBOX_ID,
          incarnation: 0,
          network_constraints_hash: null,
          operation_kind: null,
          owner_account_id: ACCOUNT_ID,
          status_operation_id: null,
        },
        {
          agent_id: CATTLE_AGENT_ID,
          project_id: PROJECT_ID,
          id: CATTLE_SANDBOX_ID,
          incarnation: 0,
          network_constraints_hash: null,
          operation_kind: null,
          owner_account_id: ACCOUNT_ID,
          status_operation_id: null,
        },
      ],
    });

    expect(
      await database
        .prepare(
          `SELECT id, operation_id, sandbox_incarnation, session_run_id, staging_id,
                  workspace_session_id
           FROM sandbox_backup ORDER BY id`,
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          id: PET_BACKUP_ID,
          operation_id: null,
          sandbox_incarnation: 0,
          session_run_id: null,
          staging_id: PET_BACKUP_ID,
          workspace_session_id: null,
        },
        {
          id: CATTLE_BACKUP_ID,
          operation_id: null,
          sandbox_incarnation: 0,
          session_run_id: RUN_ID,
          staging_id: CATTLE_BACKUP_ID,
          workspace_session_id: CATTLE_SESSION_ID,
        },
        {
          id: PRUNED_BACKUP_ID,
          operation_id: null,
          sandbox_incarnation: 0,
          session_run_id: null,
          staging_id: PRUNED_BACKUP_ID,
          workspace_session_id: null,
        },
      ],
    });

    expect(
      await database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE name IN ('__runtime_subject_authority_guard', '__runtime_subject_identity')`,
        )
        .all(),
    ).toMatchObject({ results: [] });
    expect(await columnNames(database, "driver_instance")).toContain("sandbox_incarnation");
    expect(await columnNames(database, "sandbox_session")).toContain("cleanup_operation_id");
    expect(await columnNames(database, "sandbox_backup_staging")).toEqual(
      expect.arrayContaining(["driver_generation", "driver_instance_id"]),
    );
    expect(await columnNames(database, "session")).toContain(
      "runtime_provisioning_sandbox_incarnation",
    );
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM environment_package_artifact_backup_staging")
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare(`SELECT delivery_generation FROM api_command WHERE id = '${API_COMMAND_ID}'`)
        .first(),
    ).toEqual({ delivery_generation: 1 });
    expect(
      await database.prepare("SELECT count(*) AS count FROM __protocol_v3_cutover").first(),
    ).toEqual({ count: 0 });
    expect((await cutoverCatalog(database)).length).toBe(
      PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    );
  });

  test("matches the canonical inert post-migration gate exactly", async () => {
    const migrated = createLegacyDatabase();
    applyDrizzleMigration(migrated, MIGRATION_TAG);

    const canonical = createLegacyDatabase();
    applyDrizzleMigration(canonical, MIGRATION_TAG);
    canonical.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
    canonical.execute(INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL);

    expect(await cutoverCatalog(migrated)).toEqual(await cutoverCatalog(canonical));
  });

  test("keeps the complete post-migration schema outside the exact cutover inventory", async () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(await database.prepare(PROTOCOL_V3_CUTOVER_OBJECTS_SQL).first()).toEqual({
      exact_object_count: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      object_count: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    });

    database.execute(`
      CREATE TRIGGER __protocol_v3_cutover_spoof
      BEFORE UPDATE ON sandbox WHEN 0
      BEGIN
        SELECT 1;
      END;
    `);
    expect(await database.prepare(PROTOCOL_V3_CUTOVER_OBJECTS_SQL).first()).toEqual({
      exact_object_count: 0,
      object_count: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT + 1,
    });
  });

  test("preserves a completed archive as static business state", async () => {
    const database = createLegacyDatabase();
    database.execute(
      `UPDATE session
       SET archived_at = 2, cleanup_operation_kind = 'archive'
       WHERE id = '${PET_SESSION_ID}'`,
    );

    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(
      await database
        .prepare(
          `SELECT archived_at, cleanup_operation_kind, status, status_operation_id
           FROM session WHERE id = '${PET_SESSION_ID}'`,
        )
        .first(),
    ).toEqual({
      archived_at: 2,
      cleanup_operation_kind: "archive",
      status: "IDLE",
      status_operation_id: null,
    });
  });

  test("preserves an enabled production gate and immediately rejects old writers", async () => {
    const database = createLegacyDatabase();
    const releaseTreeOid = "0123456789abcdef0123456789abcdef01234567";
    database.execute(installProtocolV3CutoverSql(releaseTreeOid));

    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(
      await database
        .prepare("SELECT enabled, release_tree_oid FROM __protocol_v3_cutover WHERE id = 1")
        .first(),
    ).toEqual({ enabled: 1, release_tree_oid: releaseTreeOid });
    expect((await cutoverCatalog(database)).length).toBe(
      PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
    );
    expect(() =>
      database.execute(
        `UPDATE sandbox
         SET claim_expires_at = 100, claim_owner = 'old-worker'
         WHERE id = '${PET_SANDBOX_ID}'`,
      ),
    ).toThrow("protocol v3 cutover blocks sandbox activation");
    expect(() =>
      database.execute(
        `INSERT INTO sandbox_backup_staging (
           created_at, dir, id, operation_id, sandbox_id, sandbox_incarnation,
           ttl_seconds, updated_at
         ) VALUES (1, '/workspace', '${id("6")}', '${OPERATION_ID}', '${PET_SANDBOX_ID}',
                   1, 60, 1)`,
      ),
    ).toThrow("protocol v3 cutover blocks new sandbox backup staging");
  });

  test("freezes identity while allowing an incarnation-fenced activation transition", () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);

    for (const assignment of [
      `id = '${id("Y")}'`,
      "kind = 'cattle'",
      "subject_kind = 'session'",
      `subject_id = '${CATTLE_SESSION_ID}'`,
      `agent_id = '${CATTLE_AGENT_ID}'`,
      `project_id = '${id("Z")}'`,
      `owner_account_id = '${id("0")}'`,
    ]) {
      expect(() =>
        database.execute(`UPDATE sandbox SET ${assignment} WHERE id = '${PET_SANDBOX_ID}'`),
      ).toThrow("sandbox identity is immutable");
    }

    expect(() =>
      database.execute(
        `UPDATE sandbox
         SET status = 'active', network_constraints_hash = '${"0".repeat(64)}'
         WHERE id = '${PET_SANDBOX_ID}'`,
      ),
    ).toThrow();

    expect(() =>
      database.execute(
        `INSERT INTO sandbox_backup_staging (
           created_at, dir, driver_generation, driver_instance_id, id, operation_id,
           sandbox_id, sandbox_incarnation, ttl_seconds, updated_at
         ) VALUES (1, '/workspace', 7, '${DRIVER_ID}', '${id("4")}', '${OPERATION_ID}',
                   '${PET_SANDBOX_ID}', 1, 60, 1)`,
      ),
    ).toThrow();
    expect(() =>
      database.execute(
        `INSERT INTO sandbox_backup_staging (
           created_at, dir, id, sandbox_id, sandbox_incarnation, session_run_id,
           ttl_seconds, updated_at, workspace_session_id
         ) VALUES (1, '/workspace', '${id("5")}', '${CATTLE_SANDBOX_ID}', 1,
                   '${RUN_ID}', 60, 1, '${CATTLE_SESSION_ID}')`,
      ),
    ).toThrow();
    for (const [driverGeneration, driverInstanceId, suffix] of [
      ["7", "NULL", "7"],
      ["NULL", `'${DRIVER_ID}'`, "8"],
      ["1.5", `'${DRIVER_ID}'`, "9"],
      ["9007199254740992", `'${DRIVER_ID}'`, "A"],
    ] as const) {
      expect(() =>
        database.execute(
          `INSERT INTO sandbox_backup_staging (
             created_at, dir, driver_generation, driver_instance_id, id, sandbox_id,
             sandbox_incarnation, session_run_id, ttl_seconds, updated_at,
             workspace_session_id
           ) VALUES (1, '/workspace', ${driverGeneration}, ${driverInstanceId}, '${id(suffix)}',
                     '${CATTLE_SANDBOX_ID}', 1, '${RUN_ID}', 60, 1,
                     '${CATTLE_SESSION_ID}')`,
        ),
      ).toThrow();
    }
    database.execute(
      `INSERT INTO sandbox_backup_staging (
         created_at, dir, driver_generation, driver_instance_id, id, sandbox_id,
         sandbox_incarnation, session_run_id, ttl_seconds, updated_at, workspace_session_id
       ) VALUES (1, '/workspace', 7, '${DRIVER_ID}', '${id("6")}',
                 '${CATTLE_SANDBOX_ID}', 1, '${RUN_ID}', 60, 1, '${CATTLE_SESSION_ID}')`,
    );

    database.execute(
      `UPDATE sandbox
       SET claim_expires_at = 100,
           claim_owner = 'activation',
           incarnation = incarnation + 1,
           network_constraints_hash = '${"0".repeat(64)}',
           operation_kind = 'activate',
           status = 'restoring',
           status_operation_id = '${OPERATION_ID}'
       WHERE id = '${PET_SANDBOX_ID}'`,
    );
  });

  test("enforces exact incarnation and provisioning authority on new writes", () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);

    expect(() =>
      database.execute(
        `UPDATE sandbox_session SET status = 'active' WHERE session_id = '${PET_SESSION_ID}'`,
      ),
    ).toThrow();
    database.execute(
      `UPDATE sandbox_session
       SET sandbox_incarnation = 1, status = 'active'
       WHERE session_id = '${PET_SESSION_ID}'`,
    );

    expect(() =>
      database.execute(
        `INSERT INTO sandbox_backup_staging (
           created_at, dir, id, operation_id, sandbox_id, sandbox_incarnation,
           ttl_seconds, updated_at
         ) VALUES (1, '/workspace', '${id("2")}', '${OPERATION_ID}', '${PET_SANDBOX_ID}',
                   0, 60, 1)`,
      ),
    ).toThrow();

    database.execute(
      `UPDATE session
       SET runtime_provisioning_heartbeat_at = 1,
           runtime_provisioning_operation_id = '${OPERATION_ID}',
           runtime_provisioning_sandbox_id = '${PET_SANDBOX_ID}'
       WHERE id = '${PET_SESSION_ID}'`,
    );
    expect(() =>
      database.execute(
        `UPDATE session
         SET runtime_provisioning_heartbeat_at = 1,
             runtime_provisioning_operation_id = '${id("3")}',
             runtime_provisioning_sandbox_id = '${PET_SANDBOX_ID}'
         WHERE id = '${CATTLE_SESSION_ID}'`,
      ),
    ).toThrow();
  });

  test("creates the environment artifact staging authority with native constraints", () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);
    const pathsJson = '{"executable":[],"node":[],"python":[]}';
    const digest = "0".repeat(64);

    const insertCommand = (
      commandId: string,
      commandDigest: string,
      claimOwner: string,
      dedupeKey: string,
    ): void => {
      const payloadJson = JSON.stringify({ projectId: PROJECT_ID, inputDigest: commandDigest });
      database.execute(
        `INSERT INTO api_command (
           attempt_count, claim_expires_at, claim_owner, created_at, dedupe_key,
           delivery_generation, id, kind, payload_json, status, updated_at
         ) VALUES (1, 9007199254740991, '${claimOwner}', 1, '${dedupeKey}', 1,
                   '${commandId}', 'environment_package_artifact_build', '${payloadJson}',
                   'running', 1)`,
      );
    };
    const insertStage = (
      commandId: string,
      stageDigest: string,
      options: {
        readonly projectId?: string;
        readonly attemptCount?: string;
        readonly claimOwner?: string;
        readonly deliveryGeneration?: string;
      } = {},
    ): void => {
      database.execute(
        `INSERT INTO environment_package_artifact_backup_staging (
           project_id, attempt_count, claim_owner, command_id, created_at,
           delivery_generation, dir, input_digest, paths_json, updated_at
         ) VALUES ('${options.projectId ?? PROJECT_ID}', ${options.attemptCount ?? "1"},
                   '${options.claimOwner ?? "owner"}', '${commandId}', 1,
                   ${options.deliveryGeneration ?? "1"}, '/artifact', '${stageDigest}',
                   '${pathsJson}', 1)`,
      );
    };

    expect(() => insertStage(API_COMMAND_ID, digest)).toThrow(
      "environment artifact backup stage lacks command authority",
    );
    database.execute(
      `UPDATE api_command
       SET attempt_count = 1, claim_expires_at = 1, claim_owner = 'owner',
           kind = 'environment_package_artifact_build',
           payload_json = '${JSON.stringify({ projectId: PROJECT_ID, inputDigest: digest })}',
           status = 'running'
       WHERE id = '${API_COMMAND_ID}'`,
    );
    expect(() => insertStage(API_COMMAND_ID, digest)).toThrow(
      "environment artifact backup stage lacks command authority",
    );
    database.execute(
      `UPDATE api_command SET claim_expires_at = 9007199254740991
       WHERE id = '${API_COMMAND_ID}'`,
    );

    for (const [attemptCount, claimOwner, deliveryGeneration, inputDigest] of [
      ["1", "owner", "1", "invalid"],
      ["0", "owner", "1", digest],
      ["1.5", "owner", "1", digest],
      ["9007199254740992", "owner", "1", digest],
      ["1", "", "1", digest],
      ["1", "owner", "0", digest],
      ["1", "owner", "1.5", digest],
      ["1", "owner", "9007199254740992", digest],
    ] as const) {
      expect(() =>
        insertStage(API_COMMAND_ID, inputDigest, {
          attemptCount,
          claimOwner,
          deliveryGeneration,
        }),
      ).toThrow();
    }
    for (const options of [
      { attemptCount: "2" },
      { claimOwner: "other-owner" },
      { deliveryGeneration: "2" },
      { projectId: id("Z") },
    ] as const) {
      expect(() => insertStage(API_COMMAND_ID, digest, options)).toThrow(
        "environment artifact backup stage lacks command authority",
      );
    }
    expect(() => insertStage(id("Y"), digest)).toThrow();

    insertStage(API_COMMAND_ID, digest);
    expect(() =>
      database.execute(
        `UPDATE environment_package_artifact_backup_staging SET dir = '/other'
         WHERE command_id = '${API_COMMAND_ID}'`,
      ),
    ).toThrow("environment artifact backup stage is immutable");
    database.execute(
      `UPDATE environment_package_artifact_backup_staging
       SET actual_backup_id = '${id("4")}', updated_at = 2
       WHERE command_id = '${API_COMMAND_ID}'`,
    );

    const duplicateIntentCommandId = id("2");
    insertCommand(duplicateIntentCommandId, digest, "owner-2", "fixture-command-2");
    expect(() =>
      insertStage(duplicateIntentCommandId, digest, { claimOwner: "owner-2" }),
    ).toThrow();

    const otherDigest = "1".repeat(64);
    const otherCommandId = id("3");
    insertCommand(otherCommandId, otherDigest, "owner-3", "fixture-command-3");
    insertStage(otherCommandId, otherDigest, { claimOwner: "owner-3" });
    expect(() =>
      database.execute(
        `UPDATE environment_package_artifact_backup_staging
         SET actual_backup_id = '${id("4")}', updated_at = 2
         WHERE command_id = '${otherCommandId}'`,
      ),
    ).toThrow();

    expect(() =>
      database.execute(
        `UPDATE api_command SET delivery_generation = 0 WHERE id = '${API_COMMAND_ID}'`,
      ),
    ).toThrow();
    expect(() =>
      database.execute(`DELETE FROM api_command WHERE id = '${API_COMMAND_ID}'`),
    ).toThrow();
  });

  test("lets only exact pre-gate Environment command authority finish staging", async () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);
    const digest = "0".repeat(64);
    const payloadJson = JSON.stringify({ projectId: PROJECT_ID, inputDigest: digest });
    database.execute(`
      UPDATE api_command
      SET attempt_count = 1,
          claim_expires_at = 9007199254740991,
          claim_owner = 'pre-gate-owner',
          created_at = 1,
          kind = 'environment_package_artifact_build',
          payload_json = '${payloadJson}',
          status = 'running'
      WHERE id = '${API_COMMAND_ID}';
      INSERT INTO __protocol_v3_cutover (id, enabled, release_tree_oid)
      VALUES (1, 1, '${"0".repeat(40)}');
    `);

    expect(() =>
      database.execute(
        `INSERT INTO api_command (
           attempt_count, created_at, dedupe_key, delivery_generation, id, kind,
           payload_json, status, updated_at
         ) VALUES (
           0, 2, 'post-gate-environment-command', 1, '${id("Y")}',
           'environment_package_artifact_build', '${payloadJson}', 'queued', 2
         )`,
      ),
    ).toThrow("protocol v3 cutover blocks new nonterminal API commands");

    database.execute(
      `INSERT INTO environment_package_artifact_backup_staging (
         project_id, attempt_count, claim_owner, command_id, created_at,
         delivery_generation, dir, input_digest, paths_json, updated_at
       ) VALUES (
         '${PROJECT_ID}', 1, 'pre-gate-owner', '${API_COMMAND_ID}', 1,
         1, '/artifact', '${digest}',
         '{"executable":[],"node":[],"python":[]}', 1
       )`,
    );
    await expect(
      database
        .prepare(
          `SELECT command_id FROM environment_package_artifact_backup_staging
           WHERE command_id = '${API_COMMAND_ID}'`,
        )
        .first(),
    ).resolves.toEqual({ command_id: API_COMMAND_ID });
  });

  test("keeps an older backup incarnation when its workspace advances", async () => {
    const database = createLegacyDatabase();
    applyDrizzleMigration(database, MIGRATION_TAG);
    database.execute(`
      UPDATE sandbox SET incarnation = 2 WHERE id = '${CATTLE_SANDBOX_ID}';
      UPDATE sandbox_session SET sandbox_incarnation = 2
      WHERE session_id = '${CATTLE_SESSION_ID}';
      INSERT INTO sandbox_backup (
        created_at, dir, id, keep, sandbox_id, sandbox_incarnation, session_run_id,
        staging_id, status, ttl_seconds, updated_at, workspace_session_id
      ) VALUES (
        3, '/workspace', '${id("7")}', 0, '${CATTLE_SANDBOX_ID}', 1, '${RUN_ID}',
        '${id("8")}', 'ready', 60, 3, '${CATTLE_SESSION_ID}'
      );
    `);

    expect(
      await database
        .prepare(
          `SELECT backup.sandbox_incarnation AS backup_incarnation,
                  workspace.sandbox_incarnation AS workspace_incarnation
           FROM sandbox_backup AS backup
           JOIN sandbox_session AS workspace
             ON workspace.session_id = backup.workspace_session_id
           WHERE backup.id = '${id("7")}'`,
        )
        .first(),
    ).toEqual({ backup_incarnation: 1, workspace_incarnation: 2 });
  });

  const rollbackCases = [
    ["active sandbox", `UPDATE sandbox SET status = 'active' WHERE id = '${PET_SANDBOX_ID}'`],
    [
      "partial sandbox identity",
      `UPDATE sandbox SET agent_id = '${PET_AGENT_ID}' WHERE id = '${PET_SANDBOX_ID}'`,
    ],
    [
      "mismatched sandbox identity",
      `UPDATE sandbox SET agent_id = '${CATTLE_AGENT_ID}', project_id = '${PROJECT_ID}',
                          owner_account_id = '${ACCOUNT_ID}'
       WHERE id = '${PET_SANDBOX_ID}'`,
    ],
    [
      "invalid sandbox subject",
      `UPDATE sandbox SET subject_kind = 'user' WHERE id = '${PET_SANDBOX_ID}'`,
    ],
    ["running session", `UPDATE session SET status = 'RUNNING' WHERE id = '${PET_SESSION_ID}'`],
    [
      "session status operation",
      `UPDATE session SET status_operation_id = '${OPERATION_ID}' WHERE id = '${PET_SESSION_ID}'`,
    ],
    [
      "session delete cleanup operation",
      `UPDATE session
       SET archived_at = 1,
           cleanup_operation_kind = 'delete',
           status = 'RESCHEDULING',
           status_operation_id = '${OPERATION_ID}'
       WHERE id = '${PET_SESSION_ID}'`,
    ],
    [
      "session provisioning authority",
      `UPDATE session
       SET runtime_provisioning_heartbeat_at = 1,
           runtime_provisioning_operation_id = '${OPERATION_ID}',
           runtime_provisioning_sandbox_id = '${PET_SANDBOX_ID}'
       WHERE id = '${PET_SESSION_ID}'`,
    ],
    [
      "sandbox claim",
      `UPDATE sandbox SET claim_owner = 'legacy', claim_expires_at = 10
       WHERE id = '${PET_SANDBOX_ID}'`,
    ],
    [
      "active sandbox session",
      `UPDATE sandbox_session SET status = 'active' WHERE session_id = '${PET_SESSION_ID}'`,
    ],
    [
      "cross-subject sandbox session",
      `UPDATE sandbox_session SET sandbox_id = '${CATTLE_SANDBOX_ID}'
       WHERE session_id = '${PET_SESSION_ID}'`,
    ],
    ["failed backup", `UPDATE sandbox_backup SET status = 'failed' WHERE id = '${PET_BACKUP_ID}'`],
    [
      "backup error",
      `UPDATE sandbox_backup SET error_message = 'failed' WHERE id = '${PET_BACKUP_ID}'`,
    ],
    [
      "duplicate terminal backup",
      `INSERT INTO sandbox_backup (
         created_at, dir, id, keep, sandbox_id, session_run_id, status, ttl_seconds, updated_at
       ) VALUES (1, '/workspace', '${id("4")}', 0, '${CATTLE_SANDBOX_ID}', '${RUN_ID}',
                 'pruned', 60, 2)`,
    ],
    [
      "cross-subject terminal backup",
      `UPDATE session_run SET session_id = '${PET_SESSION_ID}' WHERE id = '${RUN_ID}'`,
    ],
    [
      "cross-sandbox terminal backup",
      `UPDATE sandbox SET last_backup_id = NULL WHERE id = '${CATTLE_SANDBOX_ID}';
       UPDATE sandbox_backup SET sandbox_id = '${PET_SANDBOX_ID}'
       WHERE id = '${CATTLE_BACKUP_ID}'`,
    ],
    [
      "cross-directory terminal backup",
      `UPDATE sandbox_backup SET dir = '/other' WHERE id = '${CATTLE_BACKUP_ID}'`,
    ],
    [
      "mismatched terminal run agent",
      `UPDATE session_run SET agent_id = '${PET_AGENT_ID}' WHERE id = '${RUN_ID}'`,
    ],
    [
      "non-completed terminal backup",
      `UPDATE session_run SET status = 'failed' WHERE id = '${RUN_ID}'`,
    ],
    [
      "dangling backup pointer",
      `UPDATE sandbox SET last_backup_id = '${id("5")}' WHERE id = '${PET_SANDBOX_ID}'`,
    ],
    ["live driver", `UPDATE driver_instance SET status = 'ready' WHERE id = '${DRIVER_ID}'`],
    ["unsafe driver generation", `UPDATE driver_instance SET generation = 1.5`],
    ["active run", `UPDATE session_run SET status = 'running' WHERE id = '${RUN_ID}'`],
    [
      "active retired Project Deployment run",
      `INSERT INTO project_deployment (
         project_id, created_at, default_branch, deleted_at, id, last_successful_url,
         latest_run_id, mosoo_subdomain, owner_account_id, repo_name, repo_owner,
         repo_url, source_kind, updated_at
       ) VALUES ('${PROJECT_ID}', 1, 'main', NULL, '${DEPLOYMENT_ID}', NULL,
                 '${id("6")}', 'fixture-app', '${ACCOUNT_ID}', 'repo', 'owner',
                 'https://example.com/repo', 'github_public', 1);
       INSERT INTO project_deployment_run (
         project_id, created_at, deployment_id, id, source_branch, source_commit_sha,
         status, updated_at
       ) VALUES ('${PROJECT_ID}', 1, '${DEPLOYMENT_ID}', '${id("6")}', 'main',
                 '0123456789abcdef', 'building', 1)`,
    ],
    ["queued driver command", `UPDATE driver_command SET driver_generation = 7, status = 'queued'`],
    ["claimed external effect", `UPDATE external_tool_effect SET status = 'claimed'`],
    ["queued API command", `UPDATE api_command SET status = 'queued'`],
    ["running API command", `UPDATE api_command SET status = 'running'`],
  ] as const;

  for (const [name, mutation] of rollbackCases) {
    test(`rolls back every statement for ${name}`, async () => {
      const database = createLegacyDatabase();
      database.execute(mutation);

      expect(() => applyDrizzleMigration(database, MIGRATION_TAG)).toThrow();
      expect(await columnNames(database, "sandbox")).not.toContain("incarnation");
      expect(
        await database
          .prepare(
            `SELECT count(*) AS count FROM sqlite_master
             WHERE name IN ('sandbox_backup_staging', 'sandbox_identity_immutable')`,
          )
          .first<{ count: number }>(),
      ).toEqual({ count: 0 });
    });
  }
});
