import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

function physicalColumnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
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

  test("keeps the schema in sync with the applied migrations", async () => {
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
          // drizzle-kit reads snapshots from `./${out}/meta`, so an absolute
          // --out finds none, prints an error, exits 0 and writes no SQL.
          "--out",
          relative(packageRoot, outputDirectory),
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
      expect(stderr).not.toContain("Error");

      const sqlFiles = (await readdir(outputDirectory)).filter((name) => name.endsWith(".sql"));
      const sql = await Promise.all(
        sqlFiles.map((name) => readFile(join(outputDirectory, name), "utf8")),
      );

      expect(sql.join("").trim()).toBe("");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
