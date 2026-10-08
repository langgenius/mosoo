import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyProdMigrations,
  findPendingProdMigrations,
  inspectProdMigrations,
  parseAppliedMigrationNames,
} from "../bin/prod-migrations";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function ledger(names: string[]): string {
  return JSON.stringify([{ success: true, results: names.map((name) => ({ name })) }]);
}

function fixture(options: {
  applied: string[];
  queryExit?: number;
  applyExit?: number;
  applyRecords?: boolean;
}) {
  const apiDir = mkdtempSync(join(tmpdir(), "mosoo-prod-migrations-"));
  directories.push(apiDir);
  const migrations = ["0000_baseline.sql", "0001_next.sql"];
  mkdirSync(join(apiDir, "migration-files"));
  for (const name of migrations)
    writeFileSync(join(apiDir, "migration-files", name), "SELECT 1;\n");
  writeFileSync(
    join(apiDir, "wrangler.toml"),
    '[env.prod]\n[[env.prod.d1_databases]]\nbinding="DB"\nmigrations_dir="migration-files"\n',
  );
  const log = join(apiDir, "commands.jsonl");
  const marker = join(apiDir, "applied");
  const wranglerBin = join(apiDir, "fake-wrangler");
  writeFileSync(
    wranglerBin,
    `#!/usr/bin/env bun
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[1] === "execute") {
  if (!args.at(-1).startsWith('SELECT name FROM "d1_migrations"')) process.exit(9);
  process.stdout.write(existsSync(${JSON.stringify(marker)}) ? ${JSON.stringify(ledger(migrations))} : ${JSON.stringify(ledger(options.applied))});
  process.exit(${options.queryExit ?? 0});
}
if (args[1] === "migrations" && args[2] === "apply") {
  if (${options.applyRecords !== false}) writeFileSync(${JSON.stringify(marker)}, "yes");
  process.exit(${options.applyExit ?? 0});
}
process.exit(10);
`,
    { mode: 0o755 },
  );
  return {
    apiDir,
    wranglerBin,
    calls: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
  };
}

test("an up-to-date production database requires only SELECT, never migration initialization", () => {
  const f = fixture({ applied: ["0000_baseline.sql", "0001_next.sql"], applyExit: 1 });
  applyProdMigrations(f.apiDir, f.wranglerBin);
  expect(f.calls()).toHaveLength(1);
  expect(f.calls()[0]).toContain("execute");
});

test("pending migrations use the normal apply command and the ledger is checked again", () => {
  const f = fixture({ applied: ["0000_baseline.sql"] });
  applyProdMigrations(f.apiDir, f.wranglerBin);
  expect(f.calls().map((args) => args[1])).toEqual(["execute", "migrations", "execute"]);
  expect(f.calls()[1]).toEqual(["d1", "migrations", "apply", "DB", "--remote", "--env", "prod"]);
});

test("failed ledger reads stop before any migration command", () => {
  const f = fixture({ applied: [], queryExit: 1 });
  expect(() => applyProdMigrations(f.apiDir, f.wranglerBin)).toThrow(
    "Could not read production migration ledger",
  );
  expect(f.calls()).toHaveLength(1);
});

test("migration command errors and missing applied records both stop deployment", () => {
  const failed = fixture({ applied: [], applyExit: 1 });
  expect(() => applyProdMigrations(failed.apiDir, failed.wranglerBin)).toThrow(
    "Production D1 migration failed",
  );
  const incomplete = fixture({ applied: [], applyRecords: false });
  expect(() => applyProdMigrations(incomplete.apiDir, incomplete.wranglerBin)).toThrow(
    "remain unapplied",
  );
});

test("inspection reports exact pending names and rejects unsupported migration patterns", () => {
  const f = fixture({ applied: ["0000_baseline.sql"] });
  expect(inspectProdMigrations(f.apiDir, f.wranglerBin)).toEqual(["0001_next.sql"]);
  writeFileSync(
    join(f.apiDir, "wrangler.toml"),
    '[env.prod]\n[[env.prod.d1_databases]]\nbinding="DB"\nmigrations_dir="migration-files"\nmigrations_pattern="migration-files/**/*.sql"\n',
  );
  expect(() => inspectProdMigrations(f.apiDir, f.wranglerBin)).toThrow("default *.sql pattern");
  expect(f.calls()).toHaveLength(1);
});

test("malformed, failed, or duplicate ledger results never become an empty pending list", () => {
  for (const value of [
    "not json",
    "[]",
    "{}",
    '[{"success":false,"results":[]}]',
    '[{"success":true,"results":[{}]}]',
    ledger(["0000.sql", "0000.sql"]),
  ]) {
    expect(() => parseAppliedMigrationNames(value)).toThrow();
  }
});

test("missing local SQL and production migrations absent from this checkout fail closed", () => {
  expect(() => findPendingProdMigrations([], [])).toThrow("No configured");
  expect(() => findPendingProdMigrations(["0000.sql"], ["0000.sql", "0001.sql"])).toThrow(
    "absent from this checkout",
  );
});
