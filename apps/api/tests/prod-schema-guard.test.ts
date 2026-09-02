import { describe, expect, test } from "bun:test";

import { parseD1JsonResults } from "../bin/d1-json";
import {
  assertProdSchemaMatches,
  createProdSchemaCatalogFromIntrospectionRows,
  createProdSchemaCatalogFromDrizzleSnapshot,
  createProdSchemaIntrospectionStatements,
  DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG,
  findProdSchemaDifferences,
  MANAGED_PROD_SCHEMA_TRIGGERS,
  parseGeneratedProdSchemaCatalog,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL,
} from "../bin/prod-schema-guard";
import {
  applyDrizzleMigration,
  assertDrizzleMigrationFiles,
  drizzleMigrations,
  latestDrizzleSnapshotFilename,
} from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VALID_SCHEMA_SQL = `
  CREATE TABLE parent (
    id text PRIMARY KEY NOT NULL,
    state text DEFAULT 'ready' NOT NULL,
    CONSTRAINT parent_state_check CHECK (state IN ('ready', 'retired'))
  );
  CREATE TABLE child (
    tenant text NOT NULL,
    id text NOT NULL,
    parent_id text,
    CONSTRAINT child_pk PRIMARY KEY (tenant, id),
    CONSTRAINT child_parent_fk FOREIGN KEY (parent_id)
      REFERENCES parent (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT child_id_check CHECK (length(id) > 0)
  );
  CREATE UNIQUE INDEX child_parent_idx
    ON child (parent_id) WHERE parent_id IS NOT NULL;
  CREATE INDEX child_parent_expression_idx
    ON child (coalesce(parent_id, id), tenant) WHERE parent_id IS NULL;
  CREATE TABLE sequence_owner (
    id integer PRIMARY KEY AUTOINCREMENT
  );
`;

const DRIZZLE_DIRECTORY = new URL("../../../pkgs/db/drizzle/", import.meta.url);
const PROTOCOL_V3_CUTOVER_TRIGGER_NAMES = [
  "__protocol_v3_cutover_api_command_insert",
  "__protocol_v3_cutover_api_command_update",
  "__protocol_v3_cutover_command_insert",
  "__protocol_v3_cutover_driver_insert",
  "__protocol_v3_cutover_driver_update",
  "__protocol_v3_cutover_environment_artifact_backup_staging_insert",
  "__protocol_v3_cutover_project_deployment_run_insert",
  "__protocol_v3_cutover_project_deployment_run_update",
  "__protocol_v3_cutover_sandbox_backup_insert",
  "__protocol_v3_cutover_sandbox_backup_staging_insert",
  "__protocol_v3_cutover_sandbox_backup_update",
  "__protocol_v3_cutover_sandbox_insert",
  "__protocol_v3_cutover_sandbox_session_insert",
  "__protocol_v3_cutover_sandbox_session_update",
  "__protocol_v3_cutover_sandbox_update",
  "__protocol_v3_cutover_session_insert",
  "__protocol_v3_cutover_session_run_insert",
  "__protocol_v3_cutover_session_run_update",
  "__protocol_v3_cutover_session_update",
] as const;

async function readCatalog(database: SqliteD1Database) {
  const tableNames = await readTableNames(database);
  const rows = [];
  for (const statement of createProdSchemaIntrospectionStatements(tableNames)) {
    rows.push((await database.prepare(statement).all<Record<string, unknown>>()).results);
  }
  return createProdSchemaCatalogFromIntrospectionRows(rows, tableNames);
}

async function readTableNames(database: SqliteD1Database): Promise<string[]> {
  const { results } = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all<{ name: string }>();
  return results.map(({ name }) => name);
}

async function catalogFor(sql: string) {
  const database = new SqliteD1Database();
  database.execute(sql);
  return readCatalog(database);
}

describe("prod schema catalog", () => {
  test("requires the journal to exactly match every ordered migration SQL file", () => {
    const entries = [
      { idx: 0, tag: "0000_first" },
      { idx: 1, tag: "0001_second" },
    ];
    expect(() =>
      assertDrizzleMigrationFiles(entries, ["0000_first.sql", "0001_second.sql"], 2),
    ).not.toThrow();
    for (const [candidateEntries, filenames, count] of [
      [entries, ["0000_first.sql", "0001_second.sql", "0002_untracked.sql"], 2],
      [entries, ["0000_first.sql"], 2],
      [[entries[0], { idx: 2, tag: "0002_second" }], ["0000_first.sql", "0002_second.sql"], 2],
      [[entries[0], { idx: 1, tag: "0001/second" }], ["0000_first.sql", "0001/second.sql"], 2],
      [entries, ["0000_first.sql", "0001_second.sql"], 1],
    ] as const) {
      expect(() => assertDrizzleMigrationFiles(candidateEntries, filenames, count)).toThrow();
    }
  });

  test("round-trips the multi-statement D1 JSON shape", async () => {
    const database = new SqliteD1Database();
    database.execute(VALID_SCHEMA_SQL);
    const tableNames = await readTableNames(database);
    const results = [];
    for (const statement of createProdSchemaIntrospectionStatements(tableNames)) {
      results.push(await database.prepare(statement).all<Record<string, unknown>>());
    }

    expect(
      createProdSchemaCatalogFromIntrospectionRows(
        parseD1JsonResults(`wrangler log\n${JSON.stringify(results)}`),
        tableNames,
      ),
    ).toEqual(await readCatalog(database));
    const missingSuccess: unknown[] = results.slice();
    missingSuccess[0] = { results: results[0]?.results };
    expect(() => parseD1JsonResults(JSON.stringify(missingSuccess))).toThrow();
  });

  test("compares columns, composite PK, defaults, nullability, index predicate, FK, and checks", async () => {
    const expected = await catalogFor(VALID_SCHEMA_SQL);
    expect(() => assertProdSchemaMatches(expected, expected)).not.toThrow();

    expect(expected.tables.find(({ name }) => name === "child")?.indexes).toContainEqual({
      columns: ["coalesce ( parent_id , id )", "tenant"],
      name: "child_parent_expression_idx",
      predicate: "parent_id is null",
      unique: false,
    });

    const mutations = [
      VALID_SCHEMA_SQL.replace("state text", "state blob"),
      VALID_SCHEMA_SQL.replace("DEFAULT 'ready'", "DEFAULT 'retired'"),
      VALID_SCHEMA_SQL.replace("DEFAULT 'ready' NOT NULL", "DEFAULT 'ready'"),
      VALID_SCHEMA_SQL.replace("parent_id text,", "parent_id text, extra text,"),
      VALID_SCHEMA_SQL.replace("state text DEFAULT 'ready' NOT NULL", "state text"),
      VALID_SCHEMA_SQL.replace("PRIMARY KEY (tenant, id)", "PRIMARY KEY (id, tenant)"),
      VALID_SCHEMA_SQL.replace("child_parent_idx", "child_parent_other_idx"),
      VALID_SCHEMA_SQL.replace(
        "CREATE UNIQUE INDEX child_parent_idx",
        "CREATE INDEX child_parent_idx",
      ),
      VALID_SCHEMA_SQL.replace("coalesce(parent_id, id)", "coalesce(parent_id, tenant)"),
      VALID_SCHEMA_SQL.replace("WHERE parent_id IS NOT NULL", "WHERE parent_id IS NULL"),
      VALID_SCHEMA_SQL.replace("ON UPDATE NO ACTION", "ON UPDATE CASCADE"),
      VALID_SCHEMA_SQL.replace("ON DELETE CASCADE", "ON DELETE RESTRICT"),
      VALID_SCHEMA_SQL.replace("length(id) > 0", "length(id) > 1"),
      VALID_SCHEMA_SQL.replace("PRIMARY KEY AUTOINCREMENT", "PRIMARY KEY"),
    ];
    for (const mutated of mutations) {
      expect(findProdSchemaDifferences(expected, await catalogFor(mutated))).not.toEqual([]);
    }
    await expect(
      catalogFor(VALID_SCHEMA_SQL.replace("parent_id text,", "parent_id text UNIQUE,")),
    ).rejects.toThrow("unsupported inline UNIQUE constraints");
  });

  test("compares table definitions for SQLite semantics missing from pragma metadata", async () => {
    const plain = await catalogFor(`CREATE TABLE semantic (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      derived text
    )`);
    const formatted = await catalogFor(`create table "semantic"(
      "id" TEXT primary key not null,
      "source" text not null,
      "derived" text
    )`);
    expect(findProdSchemaDifferences(plain, formatted)).toEqual([]);

    for (const sql of [
      `CREATE TABLE semantic (
        id text COLLATE NOCASE PRIMARY KEY NOT NULL,
        source text NOT NULL,
        derived text
      )`,
      `CREATE TABLE semantic (
        id text PRIMARY KEY NOT NULL,
        source text NOT NULL,
        derived text
      ) STRICT`,
      `CREATE TABLE semantic (
        id text PRIMARY KEY NOT NULL,
        source text NOT NULL,
        derived text
      ) WITHOUT ROWID`,
    ]) {
      expect(findProdSchemaDifferences(plain, await catalogFor(sql))).toContain(
        "semantic.definition differs",
      );
    }

    const generatedVirtual = await catalogFor(`CREATE TABLE semantic (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      derived text GENERATED ALWAYS AS (lower(source)) VIRTUAL
    )`);
    expect(findProdSchemaDifferences(plain, generatedVirtual)).toEqual([
      "semantic.columns differs",
      "semantic.definition differs",
    ]);

    const generatedStored = await catalogFor(`CREATE TABLE semantic (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      derived text GENERATED ALWAYS AS (lower(source)) STORED
    )`);
    expect(findProdSchemaDifferences(generatedVirtual, generatedStored)).toEqual([
      "semantic.columns differs",
      "semantic.definition differs",
    ]);

    const changedExpression = await catalogFor(`CREATE TABLE semantic (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      derived text GENERATED ALWAYS AS (upper(source)) VIRTUAL
    )`);
    expect(findProdSchemaDifferences(generatedVirtual, changedExpression)).toEqual([
      "semantic.definition differs",
    ]);
  });

  test("ignores only known live internal tables and rejects application extras", async () => {
    const expected = await catalogFor(VALID_SCHEMA_SQL);
    const withInternalTables = await catalogFor(`${VALID_SCHEMA_SQL}
      CREATE TABLE d1_migrations (id integer PRIMARY KEY AUTOINCREMENT);
      CREATE TABLE _cf_KV (key text);
      CREATE TABLE __production_deploy_lease (id integer);
      CREATE TABLE __protocol_v3_cutover (id integer);
      ${PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};
    `);
    expect(findProdSchemaDifferences(expected, withInternalTables)).toEqual([]);

    const malformedMigrationIntent = await catalogFor(`${VALID_SCHEMA_SQL}
      CREATE TABLE __protocol_v3_cutover (id integer PRIMARY KEY);
      ${PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL.replace("ON DELETE CASCADE", "ON DELETE RESTRICT")};
    `);
    expect(findProdSchemaDifferences(expected, malformedMigrationIntent)).toContain(
      `${PROTOCOL_V3_MIGRATION_INTENT_TABLE}.definition differs`,
    );

    const triggeredMigrationIntent = await catalogFor(`${VALID_SCHEMA_SQL}
      CREATE TABLE __protocol_v3_cutover (id integer PRIMARY KEY);
      ${PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL};
      CREATE TRIGGER migration_intent_trigger
      AFTER INSERT ON ${PROTOCOL_V3_MIGRATION_INTENT_TABLE}
      BEGIN
        SELECT 1;
      END;
    `);
    expect(findProdSchemaDifferences(expected, triggeredMigrationIntent)).toContain(
      "unexpected trigger migration_intent_trigger",
    );

    const withRetainedLegacyTable = await catalogFor(
      `${VALID_SCHEMA_SQL} CREATE TABLE wechat_context_token (id integer);`,
    );
    expect(findProdSchemaDifferences(expected, withRetainedLegacyTable)).toEqual([]);

    for (const name of [
      "WECHAT_CONTEXT_TOKEN",
      "stale_application_table",
      "__protocol_v3_legacy_rewrite_authorization",
    ]) {
      const withUnexpectedTable = await catalogFor(
        `${VALID_SCHEMA_SQL} CREATE TABLE ${name} (id integer);`,
      );
      expect(findProdSchemaDifferences(expected, withUnexpectedTable)).toEqual([
        `unexpected table ${name}`,
      ]);
    }
  });

  test("requires the exact migration-owned trigger and rejects trigger extras", async () => {
    const database = new SqliteD1Database();
    for (const migration of drizzleMigrations.filter(({ index }) => index <= 8)) {
      applyDrizzleMigration(database, migration.tag);
    }
    const expected = await readCatalog(database);
    const managed = MANAGED_PROD_SCHEMA_TRIGGERS.find(
      ({ name }) => name === "session_event_tool_identity_consistency",
    );
    if (!managed) throw new Error("Managed trigger fixture is missing.");

    database.execute(`DROP TRIGGER ${managed.name}`);
    expect(findProdSchemaDifferences(expected, await readCatalog(database))).toContain(
      `missing trigger ${managed.name}`,
    );

    database.execute(`
      CREATE TRIGGER ${managed.name}
      BEFORE INSERT ON session_event
      WHEN 0
      BEGIN
        SELECT 1;
      END
    `);
    expect(findProdSchemaDifferences(expected, await readCatalog(database))).toContain(
      `trigger ${managed.name} differs`,
    );

    database.execute(`DROP TRIGGER ${managed.name}`);
    database.execute(managed.sql);
    database.execute(`
      CREATE TRIGGER extra_session_event_trigger
      BEFORE UPDATE ON session_event
      WHEN 0
      BEGIN
        SELECT 1;
      END
    `);
    expect(findProdSchemaDifferences(expected, await readCatalog(database))).toContain(
      "unexpected trigger extra_session_event_trigger",
    );

    database.execute(`
      CREATE TRIGGER __protocol_v3_cutover_api_command_insert
      BEFORE UPDATE ON session_event
      BEGIN
        SELECT 1;
      END
    `);
    expect(findProdSchemaDifferences(expected, await readCatalog(database))).toContain(
      "trigger __protocol_v3_cutover_api_command_insert differs",
    );
  });

  test("pins the transient cutover trigger set through authority migrations", async () => {
    const database = new SqliteD1Database();
    const stages = [];
    for (const migration of drizzleMigrations) {
      applyDrizzleMigration(database, migration.tag);
      if (
        migration.tag === "0020_runtime-subject-operation-authority" ||
        migration.tag === "0021_sandbox-backup-object-authority"
      ) {
        stages.push({
          tag: migration.tag,
          triggers: (await readCatalog(database)).triggers.filter(({ name }) =>
            name.startsWith("__protocol_v3_cutover_"),
          ),
        });
      }
    }

    const canonical = DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG.triggers.filter(({ name }) =>
      name.startsWith("__protocol_v3_cutover_"),
    );
    expect(canonical.map(({ name }) => name)).toEqual(PROTOCOL_V3_CUTOVER_TRIGGER_NAMES);
    expect(stages).toEqual([
      { tag: "0020_runtime-subject-operation-authority", triggers: canonical },
      { tag: "0021_sandbox-backup-object-authority", triggers: canonical },
    ]);
  });

  test("matches the complete migration chain against the latest snapshot", async () => {
    const snapshot = await Bun.file(
      new URL(`meta/${latestDrizzleSnapshotFilename}`, DRIZZLE_DIRECTORY),
    ).json();
    const expected = createProdSchemaCatalogFromDrizzleSnapshot(snapshot);
    expect(findProdSchemaDifferences(expected, DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG)).toEqual([]);
    const deployExpected = parseGeneratedProdSchemaCatalog(JSON.stringify(snapshot));
    expect(deployExpected.tables.every(({ definition }) => definition !== null)).toBeTrue();
    expect(
      findProdSchemaDifferences(deployExpected, DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG),
    ).toEqual([]);

    const firstTable = Object.values(
      (snapshot as { tables: Record<string, Record<string, unknown>> }).tables,
    )[0];
    if (firstTable === undefined) throw new Error("Drizzle snapshot table fixture is missing.");
    firstTable["uniqueConstraints"] = { unsupported: {} };
    expect(() => createProdSchemaCatalogFromDrizzleSnapshot(snapshot)).toThrow(
      "unsupported inline UNIQUE constraints",
    );
  });

  test("fails closed on malformed D1 output", () => {
    expect(() => parseD1JsonResults("not json")).toThrow();
    expect(() => parseD1JsonResults("[]")).toThrow();
  });
});
