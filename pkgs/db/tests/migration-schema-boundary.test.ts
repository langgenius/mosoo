import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName, isTable } from "drizzle-orm";

import drizzleConfig from "../drizzle.config";
import { sessionRunsTable } from "../src";
import * as migrationSchema from "../src/migration-schema";
import { retiredSessionRunsPhysicalStorage } from "../src/schema/retired-project-deployment-storage.schema";

const RETIRED_SESSION_RUN_COLUMNS = [
  "bound_capability_agent_id",
  "bound_capability_project_id",
  "bound_capability_binding_env",
  "bound_capability_binding_name",
  "bound_capability_deployment_id",
  "bound_capability_deployment_run_id",
] as const;

const ALLOWED_BASELINE_STATEMENTS = new Set([
  "DROP TABLE `agent_channel_binding`;",
  "DROP TABLE `channel_runtime_state`;",
  "DROP TABLE `channel_event_receipt`;",
  "DROP TABLE `channel_final_delivery_job`;",
  "DROP TABLE `channel_thread_session`;",
  "DROP TABLE `wechat_channel_account`;",
  "DROP TABLE `wechat_channel_pairing`;",
  "DROP TABLE `wechat_context_token`;",
]);

function physicalColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyMigration(database: Database, path: string): Promise<void> {
  const sql = await readFile(path, "utf8");

  for (const statement of migrationStatements(sql)) {
    database.exec(statement);
  }
}

describe("DB migration schema boundary", () => {
  test("applies the full migration chain and preserves Project rows across the rename", async () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const migrationsDirectory = join(packageRoot, "drizzle");
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .toSorted();
    const renameMigrationIndex = migrationFiles.indexOf("0012_rename_app_to_project.sql");
    const database = new Database(":memory:");
    const agentId = "01J00000000000000000000001";
    const projectId = "01J00000000000000000000000";

    expect(renameMigrationIndex).toBeGreaterThan(0);

    try {
      database.exec("PRAGMA foreign_keys = OFF");

      for (const migrationFile of migrationFiles.slice(0, renameMigrationIndex)) {
        await applyMigration(database, join(migrationsDirectory, migrationFile));
      }

      database
        .query(
          "INSERT INTO app (created_at, id, name, organization_id, owner_account_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(1, projectId, "Migration Canary", projectId, projectId, 1);
      database
        .query(
          "INSERT INTO agent (config_json, created_at, id, kind, model, name, owner_account_id, app_id, prompt, provider, runtime_id, status, updated_at, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "{}",
          1,
          agentId,
          "pet",
          "gpt-5.4",
          "Migration Agent",
          projectId,
          projectId,
          "Test migration.",
          "openai",
          "openai-runtime",
          "draft",
          1,
          "private",
        );

      await applyMigration(
        database,
        join(migrationsDirectory, migrationFiles[renameMigrationIndex] ?? ""),
      );

      expect(database.query("SELECT id, name FROM project WHERE id = ?").get(projectId)).toEqual({
        id: projectId,
        name: "Migration Canary",
      });
      expect(database.query("SELECT id, project_id FROM agent WHERE id = ?").get(agentId)).toEqual({
        id: agentId,
        project_id: projectId,
      });
      expect(
        database
          .query("PRAGMA table_info(agent)")
          .all()
          .map((column) => (column as { name: string }).name),
      ).toContain("project_id");
      expect(
        database
          .query("SELECT sql FROM sqlite_master WHERE name = 'project_deployment'")
          .get<{ sql: string }>()?.sql,
      ).toContain('CHECK("project_deployment"."source_kind"');
      expect(database.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(database.query("PRAGMA legacy_alter_table").get()).toEqual({ legacy_alter_table: 1 });
    } finally {
      database.close();
    }
  });

  test("keeps retired Session Run columns out of the runtime table", () => {
    const runtimeColumns = new Set(physicalColumnNames(sessionRunsTable));
    const migrationColumns = new Set(physicalColumnNames(retiredSessionRunsPhysicalStorage));
    const migrationTableNames = Object.values(migrationSchema)
      .filter(isTable)
      .map((table) => getTableName(table));

    for (const column of RETIRED_SESSION_RUN_COLUMNS) {
      expect(runtimeColumns.has(column)).toBe(false);
      expect(migrationColumns.has(column)).toBe(true);
    }

    expect(new Set(migrationTableNames).size).toBe(migrationTableNames.length);
    expect(migrationTableNames.filter((name) => name === "session_run")).toEqual(["session_run"]);
  });

  test("keeps the next migration within the known Channel-schema baseline", async () => {
    expect(drizzleConfig.schema).toBe("./src/migration-schema.ts");

    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const drizzleKit = fileURLToPath(new URL("../node_modules/.bin/drizzle-kit", import.meta.url));
    const sourceMeta = fileURLToPath(new URL("../drizzle/meta", import.meta.url));
    const tempRoot = await mkdtemp(join(tmpdir(), "mosoo-db-migration-boundary-"));
    const outputDirectory = join(tempRoot, "drizzle");

    try {
      await mkdir(outputDirectory);
      await cp(sourceMeta, join(outputDirectory, "meta"), { recursive: true });

      const process = Bun.spawn(
        [
          drizzleKit,
          "generate",
          "--dialect",
          "sqlite",
          "--schema",
          "./src/migration-schema.ts",
          "--out",
          outputDirectory,
          "--name",
          "migration-boundary-probe",
          "--prefix",
          "index",
        ],
        {
          cwd: packageRoot,
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stderr, stdout] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
        new Response(process.stdout).text(),
      ]);

      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);

      const sqlFiles = (await readdir(outputDirectory)).filter((name) => name.endsWith(".sql"));
      const sql = (
        await Promise.all(sqlFiles.map((name) => readFile(join(outputDirectory, name), "utf8")))
      ).join("\n--> statement-breakpoint\n");
      const unexpectedStatements = migrationStatements(sql).filter(
        (statement) => !ALLOWED_BASELINE_STATEMENTS.has(statement),
      );

      expect(unexpectedStatements).toEqual([]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
