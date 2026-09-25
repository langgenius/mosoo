import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const migrations = new URL("../drizzle/", import.meta.url);
const migrationName = "0017_optional-session-agent.sql";
const migrationSql = readFileSync(new URL(migrationName, migrations), "utf8");
const seedSql = readFileSync(
  new URL("./fixtures/optional-session-agent.sql", import.meta.url),
  "utf8",
);
const preservedTables = [
  "session",
  "session_run",
  "session_event",
  "session_message",
  "session_execution_snapshot",
  "session_readiness_snapshot",
  "session_run_budget",
  "session_run_skill",
  "session_model_call",
  "session_permission_request",
  "native_resume_ref",
  "sandbox_session",
  "usage_event",
  "usage_daily_rollup",
] as const;
const nullableTables = [
  "session",
  "session_run",
  "session_event",
  "usage_event",
  "usage_daily_rollup",
] as const;

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean);
}

function createPreMigrationDatabase(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  // Empty baseline setup; foreign keys remain enabled while the populated
  // optional-provenance migration executes inside one atomic transaction.
  for (const entry of readdirSync(migrations)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < migrationName)
    .toSorted()) {
    for (const statement of statements(readFileSync(new URL(entry, migrations), "utf8")))
      db.exec(statement);
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(seedSql);
  return db;
}

function applyMigration(db: Database): void {
  for (const statement of statements(migrationSql)) db.exec(statement);
}

function storedRows(db: Database) {
  // Fresh statements also refresh SELECT * column names after a column swap.
  return Object.fromEntries(
    preservedTables.map((table) => [
      table,
      db
        .prepare(`SELECT * FROM ${table}`)
        .all<Record<string, unknown>>()
        .map((row) => {
          const { agent_scope_key: _generatedGroupingKey, ...stored } = row;
          return stored;
        }),
    ]),
  );
}

function existingIndexes(db: Database) {
  return db
    .query(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
    )
    .all<{ name: string; tbl_name: string }>();
}

describe("optional Session Agent migration", () => {
  test("retains all populated history, native references, budgets, and existing indexes with foreign keys on", () => {
    const db = createPreMigrationDatabase();
    try {
      const before = storedRows(db);
      const indexes = existingIndexes(db);
      const foreignKeys = preservedTables.map((table) =>
        db.query(`PRAGMA foreign_key_list(${table})`).all(),
      );
      db.transaction(() => applyMigration(db))();
      expect(storedRows(db)).toEqual(before);
      expect(existingIndexes(db)).toEqual(
        [
          ...indexes,
          { name: "usage_daily_rollup_dimensions_idx", tbl_name: "usage_daily_rollup" },
        ].toSorted((a, b) => a.name.localeCompare(b.name)),
      );
      expect(
        preservedTables.map((table) => db.query(`PRAGMA foreign_key_list(${table})`).all()),
      ).toEqual(foreignKeys);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      for (const table of nullableTables) {
        db.exec(`UPDATE ${table} SET agent_id = NULL`);
        expect(db.query(`SELECT agent_id FROM ${table}`).get()).toEqual({ agent_id: null });
        expect(() => db.exec(`UPDATE ${table} SET agent_id = 'not-a-platform-id'`)).toThrow();
      }
      expect(() => db.exec("UPDATE session SET status = 'invalid'")).toThrow();
      expect(() => db.exec("UPDATE session_run SET status_seq = -1")).toThrow();
      expect(db.query("SELECT value FROM native_resume_ref").get()).toEqual({
        value: "original-native-context",
      });
      expect(db.query("SELECT cwd FROM sandbox_session").get()).toEqual({
        cwd: "/workspace/original",
      });
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally {
      db.close();
    }
  });

  test("rolls back schema and all records when a later migration statement fails", () => {
    const db = createPreMigrationDatabase();
    try {
      const before = storedRows(db);
      const schema = db
        .query("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
        .all();
      expect(() =>
        db.transaction(() => {
          applyMigration(db);
          db.exec("INSERT INTO absent_migration_tail VALUES (1)");
        })(),
      ).toThrow("absent_migration_tail");
      expect(storedRows(db)).toEqual(before);
      expect(
        db.query("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all(),
      ).toEqual(schema);
      expect(() => db.exec("UPDATE session SET agent_id = NULL")).toThrow();
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
