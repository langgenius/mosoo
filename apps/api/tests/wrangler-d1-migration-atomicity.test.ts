import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseD1JsonResults } from "../bin/d1-json";
import {
  createProdSchemaCatalogFromIntrospectionRows,
  DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG,
  createProdSchemaIntrospectionStatements,
  findProdSchemaDifferences,
} from "../bin/prod-schema-guard";
import {
  installProtocolV3CutoverSql,
  installProtocolV3PostMigrationCutoverSql,
  PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_CUTOVER_OBJECTS_SQL,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
} from "../bin/protocol-v3-cutover";
import { drizzleMigrations, getDrizzleMigration } from "./helpers/drizzle-migrations";

const MIGRATION_TAG = "0020_runtime-subject-operation-authority";
const SCHEMA_MIGRATION_TAG = "0021_sandbox-backup-object-authority";
const RELEASE_TREE_OID = "0123456789abcdef0123456789abcdef01234567";
const migrationsSource = fileURLToPath(new URL("../../../pkgs/db/drizzle/", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));

interface WranglerResult {
  readonly output: string;
  readonly status: number | null;
}

function runWrangler(root: string, args: readonly string[]): WranglerResult {
  const result = spawnSync(wrangler, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      TMPDIR: join(root, "tmp"),
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: join(root, "logs"),
      WRANGLER_WRITE_LOGS: "false",
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_CONFIG_HOME: join(root, "config"),
    },
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return {
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    status: result.status,
  };
}

function runWranglerSuccessfully(root: string, args: readonly string[]): string {
  const result = runWrangler(root, args);
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${result.output}`);
  }
  return result.output;
}

function localD1Args(state: string, action: "execute" | "migrations", tail: string[]): string[] {
  return [
    "d1",
    action,
    ...(action === "migrations" ? ["apply"] : []),
    "DB",
    "--local",
    "--persist-to",
    state,
    ...tail,
  ];
}

interface MigrationStateExpectation {
  readonly authorityColumnCount: number;
  readonly backupAuthorityWithoutRowidCount: number;
  readonly gateObjectCount: number;
  readonly lastMigration: string;
  readonly stagingClaimOwnerCount: number;
  readonly stagingIndexCount: number;
  readonly stagingTableCount: number;
  readonly targetApplied: number;
}

interface MigrationAtomicityFixture {
  readonly failurePoint: string;
  readonly gateSql: string;
  readonly initialGateObjectCount: number;
  readonly recovered: MigrationStateExpectation;
  readonly rolledBack: MigrationStateExpectation;
  readonly verifyLatestCatalog: boolean;
}

const MIGRATION_ATOMICITY_CASES = [
  [
    MIGRATION_TAG,
    {
      failurePoint: "ALTER TABLE `driver_instance` ADD `sandbox_incarnation`",
      gateSql: installProtocolV3CutoverSql(RELEASE_TREE_OID),
      initialGateObjectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
      recovered: {
        authorityColumnCount: 1,
        backupAuthorityWithoutRowidCount: 0,
        gateObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
        lastMigration: `${MIGRATION_TAG}.sql`,
        stagingClaimOwnerCount: 0,
        stagingIndexCount: 4,
        stagingTableCount: 2,
        targetApplied: 1,
      },
      rolledBack: {
        authorityColumnCount: 0,
        backupAuthorityWithoutRowidCount: 0,
        gateObjectCount: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
        lastMigration: "0019_runtime-operation-ready-authority.sql",
        stagingClaimOwnerCount: 0,
        stagingIndexCount: 0,
        stagingTableCount: 0,
        targetApplied: 0,
      },
      verifyLatestCatalog: false,
    },
  ],
  [
    SCHEMA_MIGRATION_TAG,
    {
      failurePoint: "CREATE TRIGGER `sandbox_backup_delete_intent_authority`",
      gateSql: installProtocolV3PostMigrationCutoverSql(RELEASE_TREE_OID),
      initialGateObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
      recovered: {
        authorityColumnCount: 1,
        backupAuthorityWithoutRowidCount: 5,
        gateObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
        lastMigration: `${SCHEMA_MIGRATION_TAG}.sql`,
        stagingClaimOwnerCount: 1,
        stagingIndexCount: 4,
        stagingTableCount: 2,
        targetApplied: 1,
      },
      rolledBack: {
        authorityColumnCount: 1,
        backupAuthorityWithoutRowidCount: 0,
        gateObjectCount: PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
        lastMigration: `${MIGRATION_TAG}.sql`,
        stagingClaimOwnerCount: 0,
        stagingIndexCount: 4,
        stagingTableCount: 2,
        targetApplied: 0,
      },
      verifyLatestCatalog: true,
    },
  ],
] as const satisfies readonly (readonly [string, MigrationAtomicityFixture])[];

const SCHEMA_MIGRATION_STAGING_SEED_SQL = `
INSERT INTO sandbox (
  agent_id, project_id, claim_expires_at, claim_owner, created_at, id, incarnation,
  kind, network_constraints_hash, operation_kind, owner_account_id, status,
  status_operation_id, subject_id, subject_kind, updated_at
) VALUES (
  '01J0000000000000000000000B', '01J0000000000000000000000C', 2000000000000,
  'live-owner', 1, '01J0000000000000000000000A', 2, 'pet', '${"0".repeat(64)}',
  'hibernate', '01J0000000000000000000000D', 'backing_up',
  '01J0000000000000000000000E', '01J0000000000000000000000B', 'agent', 2
);
INSERT INTO sandbox_backup_staging (
  actual_backup_id, created_at, dir, driver_generation, driver_instance_id, id,
  operation_id, sandbox_id, sandbox_incarnation, session_run_id, ttl_seconds,
  updated_at, updates_subject_backup, workspace_session_id
) VALUES
  ('01J0000000000000000000000M', 10, '/workspace/live', NULL, NULL,
   '01J0000000000000000000000G', '01J0000000000000000000000E',
   '01J0000000000000000000000A', 2, NULL, 60, 11, 1, NULL),
  ('01J0000000000000000000000N', 20, '/workspace/stale', NULL, NULL,
   '01J0000000000000000000000H', '01J0000000000000000000000F',
   '01J0000000000000000000000A', 2, NULL, 90, 21, 0, NULL),
  ('01J0000000000000000000000P', 30, '/workspace/terminal', 3,
   '01J0000000000000000000000K', '01J0000000000000000000000J', NULL,
   '01J0000000000000000000000A', 2, '01J0000000000000000000000Q',
   120, 31, 0, '01J0000000000000000000000R');
INSERT INTO sandbox_backup (
  created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
  session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
) VALUES (
  40, '/workspace/ready', '01J0000000000000000000000V', 1,
  '01J0000000000000000000000E', '01J0000000000000000000000A', 2, NULL,
  '01J0000000000000000000000W', 'ready', 180, 41, NULL
);
INSERT INTO api_command (
  attempt_count, claim_expires_at, claim_owner, created_at, dedupe_key,
  delivery_generation, id, kind, payload_json, status, updated_at
) VALUES (
  4, 2000000000000, 'environment-owner', 42, 'environment-artifact-migration-seed',
  3, '01J0000000000000000000000X', 'environment_package_artifact_build',
  '{"projectId":"01J0000000000000000000000Y","inputDigest":"${"c".repeat(64)}"}',
  'running', 43
);
INSERT INTO environment_package_artifact_backup_staging (
  actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
  delivery_generation, dir, input_digest, paths_json, updated_at
) VALUES (
  '01J0000000000000000000000Z', '01J0000000000000000000000Y', 4,
  'environment-owner', '01J0000000000000000000000X', 42, 3,
  '/workspace/.mosoo/environment-artifacts/${"c".repeat(64)}', '${"c".repeat(64)}',
  '{"executable":["/workspace/.mosoo/environment-artifacts/${"c".repeat(64)}/bin"],"node":[],"python":[]}',
  43
);
`;

function executeLocalD1Json(root: string, state: string, sql: string) {
  return parseD1JsonResults(
    runWranglerSuccessfully(
      root,
      localD1Args(state, "execute", ["--command", sql, "--json", "--yes"]),
    ),
  );
}

function expectExactCutoverGate(root: string, state: string, expectedObjectCount: number): void {
  expect(executeLocalD1Json(root, state, PROTOCOL_V3_CUTOVER_OBJECTS_SQL)).toEqual([
    [{ exact_object_count: expectedObjectCount, object_count: expectedObjectCount }],
  ]);
}

function expectMigrationState(
  root: string,
  state: string,
  migrationTag: string,
  expected: MigrationStateExpectation,
): void {
  expect(
    executeLocalD1Json(
      root,
      state,
      `SELECT value FROM rollback_probe WHERE id = 1;
       SELECT count(*) AS count FROM pragma_table_info('sandbox') WHERE name = 'incarnation';
       SELECT count(*) AS count FROM pragma_table_info('api_command')
         WHERE name = 'delivery_generation';
       SELECT count(*) AS count FROM pragma_table_info('app_deployment')
         WHERE name = 'active_script_name';
       SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('sandbox_backup_staging', 'environment_package_artifact_backup_staging');
       SELECT count(*) AS count FROM pragma_table_info('sandbox_backup_staging')
         WHERE name = 'claim_owner';
       SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'sandbox_backup_staging'
           AND name IN ('sandbox_backup_staging_updated_idx',
                        'sandbox_backup_staging_actual_idx',
                        'sandbox_backup_staging_terminal_checkpoint_idx',
                        'sandbox_backup_staging_operation_checkpoint_idx');
       SELECT count(*) AS count FROM pragma_table_list
         WHERE name IN ('environment_package_artifact_backup',
                        'environment_package_artifact_backup_staging',
                        'sandbox_backup',
                        'sandbox_backup_delete_intent',
                        'sandbox_backup_staging')
           AND wr = 1;
       ${PROTOCOL_V3_CUTOVER_OBJECTS_SQL}
       SELECT enabled, release_tree_oid FROM __protocol_v3_cutover WHERE id = 1;
       SELECT count(*) AS count FROM d1_migrations WHERE name = '${migrationTag}.sql';
       SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1;`,
    ),
  ).toEqual([
    [{ value: 1 }],
    [{ count: expected.authorityColumnCount }],
    [{ count: expected.authorityColumnCount }],
    [{ count: 0 }],
    [{ count: expected.stagingTableCount }],
    [{ count: expected.stagingClaimOwnerCount }],
    [{ count: expected.stagingIndexCount }],
    [{ count: expected.backupAuthorityWithoutRowidCount }],
    [
      {
        exact_object_count: expected.gateObjectCount,
        object_count: expected.gateObjectCount,
      },
    ],
    [{ enabled: 1, release_tree_oid: RELEASE_TREE_OID }],
    [{ count: expected.targetApplied }],
    [{ name: expected.lastMigration }],
  ]);
}

function expectSchemaMigrationAuthorityRows(root: string, state: string, migrated: boolean): void {
  const claimOwner = migrated ? "claim_owner" : "NULL AS claim_owner";
  expect(
    executeLocalD1Json(
      root,
      state,
      `SELECT actual_backup_id, ${claimOwner}, created_at, dir, driver_generation,
         driver_instance_id, id, operation_id, sandbox_id, sandbox_incarnation,
         session_run_id, ttl_seconds, updated_at, updates_subject_backup,
         workspace_session_id
       FROM sandbox_backup_staging ORDER BY id;
       SELECT created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
         session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
       FROM sandbox_backup ORDER BY id;
       SELECT actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
         delivery_generation, dir, input_digest, paths_json, updated_at
       FROM environment_package_artifact_backup_staging ORDER BY command_id;
       PRAGMA foreign_key_check`,
    ),
  ).toEqual([
    [
      {
        actual_backup_id: "01J0000000000000000000000M",
        claim_owner: migrated ? "live-owner" : null,
        created_at: 10,
        dir: "/workspace/live",
        driver_generation: null,
        driver_instance_id: null,
        id: "01J0000000000000000000000G",
        operation_id: "01J0000000000000000000000E",
        sandbox_id: "01J0000000000000000000000A",
        sandbox_incarnation: 2,
        session_run_id: null,
        ttl_seconds: 60,
        updated_at: 11,
        updates_subject_backup: 1,
        workspace_session_id: null,
      },
      {
        actual_backup_id: "01J0000000000000000000000N",
        claim_owner: migrated ? "__legacy_stale__" : null,
        created_at: 20,
        dir: "/workspace/stale",
        driver_generation: null,
        driver_instance_id: null,
        id: "01J0000000000000000000000H",
        operation_id: "01J0000000000000000000000F",
        sandbox_id: "01J0000000000000000000000A",
        sandbox_incarnation: 2,
        session_run_id: null,
        ttl_seconds: 90,
        updated_at: 21,
        updates_subject_backup: 0,
        workspace_session_id: null,
      },
      {
        actual_backup_id: "01J0000000000000000000000P",
        claim_owner: null,
        created_at: 30,
        dir: "/workspace/terminal",
        driver_generation: 3,
        driver_instance_id: "01J0000000000000000000000K",
        id: "01J0000000000000000000000J",
        operation_id: null,
        sandbox_id: "01J0000000000000000000000A",
        sandbox_incarnation: 2,
        session_run_id: "01J0000000000000000000000Q",
        ttl_seconds: 120,
        updated_at: 31,
        updates_subject_backup: 0,
        workspace_session_id: "01J0000000000000000000000R",
      },
    ],
    [
      {
        created_at: 40,
        dir: "/workspace/ready",
        id: "01J0000000000000000000000V",
        keep: 1,
        operation_id: "01J0000000000000000000000E",
        sandbox_id: "01J0000000000000000000000A",
        sandbox_incarnation: 2,
        session_run_id: null,
        staging_id: "01J0000000000000000000000W",
        status: "ready",
        ttl_seconds: 180,
        updated_at: 41,
        workspace_session_id: null,
      },
    ],
    [
      {
        actual_backup_id: "01J0000000000000000000000Z",
        project_id: "01J0000000000000000000000Y",
        attempt_count: 4,
        claim_owner: "environment-owner",
        command_id: "01J0000000000000000000000X",
        created_at: 42,
        delivery_generation: 3,
        dir: `/workspace/.mosoo/environment-artifacts/${"c".repeat(64)}`,
        input_digest: "c".repeat(64),
        paths_json: JSON.stringify({
          executable: [`/workspace/.mosoo/environment-artifacts/${"c".repeat(64)}/bin`],
          node: [],
          python: [],
        }),
        updated_at: 43,
      },
    ],
    [],
  ]);
}

function expectLatestSchemaCatalog(root: string, state: string): void {
  runWranglerSuccessfully(
    root,
    localD1Args(state, "execute", [
      "--command",
      "DROP TABLE rollback_probe; DROP TABLE __protocol_v3_migration_intent",
      "--yes",
    ]),
  );
  const tableNames = DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG.tables.map(({ name }) => name);
  const catalogOutput = runWranglerSuccessfully(
    root,
    localD1Args(state, "execute", [
      "--command",
      createProdSchemaIntrospectionStatements(tableNames).join(";\n"),
      "--json",
      "--yes",
    ]),
  );
  expect(
    findProdSchemaDifferences(
      DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG,
      createProdSchemaCatalogFromIntrospectionRows(parseD1JsonResults(catalogOutput), tableNames),
    ),
  ).toEqual([]);
}

test.each(MIGRATION_ATOMICITY_CASES)(
  "Wrangler rolls back and can reapply %s after a middle failure",
  (migrationTag, fixture) => {
    const root = mkdtempSync(join(tmpdir(), "mosoo-wrangler-migration-"));
    try {
      const migrations = join(root, "migrations");
      const state = join(root, "state");
      for (const directory of ["cache", "config", "migrations", "tmp"]) {
        mkdirSync(join(root, directory));
      }
      writeFileSync(join(root, "worker.ts"), "export default {};\n");
      writeFileSync(
        join(root, "wrangler.toml"),
        `name = "migration-atomicity"
main = "worker.ts"
compatibility_date = "2026-08-30"

[[d1_databases]]
binding = "DB"
database_name = "migration-atomicity"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"
`,
      );

      const target = getDrizzleMigration(migrationTag);
      for (const migration of drizzleMigrations.slice(0, target.index)) {
        copyFileSync(
          join(migrationsSource, `${migration.tag}.sql`),
          join(migrations, `${migration.tag}.sql`),
        );
      }
      runWranglerSuccessfully(root, localD1Args(state, "migrations", []));

      const setup = join(root, "setup.sql");
      writeFileSync(
        setup,
        `${migrationTag === SCHEMA_MIGRATION_TAG ? SCHEMA_MIGRATION_STAGING_SEED_SQL : ""}
${fixture.gateSql}
CREATE TABLE rollback_probe (id integer PRIMARY KEY, value integer NOT NULL);
INSERT INTO rollback_probe (id, value) VALUES (1, 1);
`,
      );
      runWranglerSuccessfully(root, localD1Args(state, "execute", ["--file", setup, "--yes"]));
      expectExactCutoverGate(root, state, fixture.initialGateObjectCount);

      const source = readFileSync(join(migrationsSource, `${migrationTag}.sql`), "utf8");
      expect(source.split(fixture.failurePoint)).toHaveLength(2);
      writeFileSync(
        join(migrations, `${migrationTag}.sql`),
        source.replace(
          fixture.failurePoint,
          `UPDATE rollback_probe SET value = 2 WHERE id = 1;--> statement-breakpoint
SELECT * FROM __intentional_mid_migration_failure;--> statement-breakpoint
${fixture.failurePoint}`,
        ),
      );

      const failed = runWrangler(root, localD1Args(state, "migrations", []));
      expect(failed.status).not.toBe(0);
      expect(failed.output).toContain("__intentional_mid_migration_failure");
      expectMigrationState(root, state, migrationTag, fixture.rolledBack);
      if (migrationTag === SCHEMA_MIGRATION_TAG) {
        expectSchemaMigrationAuthorityRows(root, state, false);
      }

      writeFileSync(join(migrations, `${migrationTag}.sql`), source);
      runWranglerSuccessfully(root, localD1Args(state, "migrations", []));
      expectMigrationState(root, state, migrationTag, fixture.recovered);
      if (migrationTag === SCHEMA_MIGRATION_TAG) {
        expectSchemaMigrationAuthorityRows(root, state, true);
      }
      if (fixture.verifyLatestCatalog) expectLatestSchemaCatalog(root, state);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
  120_000,
);
