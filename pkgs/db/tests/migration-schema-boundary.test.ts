import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName, isTable } from "drizzle-orm";

import drizzleConfig from "../drizzle.config";
import { sessionRunsTable } from "../src";
import * as migrationSchema from "../src/migration-schema";
import { retiredSessionRunsPhysicalStorage } from "../src/schema/retired-app-deployment-storage.schema";

const RETIRED_SESSION_RUN_COLUMNS = [
  "bound_capability_agent_id",
  "bound_capability_app_id",
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

describe("DB migration schema boundary", () => {
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
