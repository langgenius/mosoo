#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { BunRuntime } from "../../../config/bun-script-types";

declare const Bun: BunRuntime;

interface WranglerProductionConfig {
  env?: {
    prod?: {
      d1_databases?: {
        binding: string;
        migrations_dir?: string;
        migrations_table?: string;
        migrations_pattern?: string;
      }[];
    };
  };
}

export function parseAppliedMigrationNames(stdout: string): string[] {
  const response: unknown = JSON.parse(stdout);
  if (!Array.isArray(response) || response.length !== 1) {
    throw new Error("Expected exactly one D1 migration ledger result.");
  }
  const result: unknown = response[0];
  if (
    typeof result !== "object" ||
    result === null ||
    !("success" in result) ||
    result.success !== true ||
    !("results" in result) ||
    !Array.isArray(result.results)
  ) {
    throw new Error("D1 migration ledger query did not return a successful result.");
  }
  const names = result.results.map((row: unknown) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("name" in row) ||
      typeof row.name !== "string" ||
      row.name.length === 0
    ) {
      throw new Error("Invalid migration name in D1 ledger.");
    }
    return row.name;
  });
  if (new Set(names).size !== names.length) {
    throw new Error("Duplicate migration names in D1 ledger.");
  }
  return names;
}

export function findPendingProdMigrations(
  local: readonly string[],
  applied: readonly string[],
): string[] {
  if (local.length === 0) throw new Error("No configured production migration SQL files found.");
  const localNames = new Set(local);
  const unknown = applied.filter((name) => !localNames.has(name));
  if (unknown.length > 0) {
    throw new Error(`Production has migrations absent from this checkout: ${unknown.join(", ")}`);
  }
  const appliedNames = new Set(applied);
  return local.filter((name) => !appliedNames.has(name));
}

/** Read only: Wrangler's migrations list/apply both initialize the ledger with DDL. */
export function inspectProdMigrations(apiDir: string, wranglerBin: string): string[] {
  const config = Bun.TOML.parse(
    readFileSync(resolve(apiDir, "wrangler.toml"), "utf8"),
  ) as WranglerProductionConfig;
  const bindings = config.env?.prod?.d1_databases?.filter((db) => db.binding === "DB");
  if (bindings?.length !== 1) throw new Error("Expected one production DB binding.");
  const binding = bindings[0];
  const directory = binding.migrations_dir;
  if (
    !directory ||
    (binding.migrations_pattern !== undefined &&
      binding.migrations_pattern !== `${directory}/*.sql`)
  ) {
    throw new Error(
      "Production migration inspection requires a configured directory and the default *.sql pattern.",
    );
  }
  const local = readdirSync(resolve(apiDir, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .toSorted();
  const table = (binding.migrations_table ?? "d1_migrations").replace(/"/g, '""');
  const result = Bun.spawnSync(
    [
      wranglerBin,
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      "prod",
      "--json",
      "--command",
      `SELECT name FROM "${table}" ORDER BY id`,
    ],
    { cwd: apiDir },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not read production migration ledger (exit ${result.exitCode}): ${result.stderr.toString("utf8")}`,
    );
  }
  return findPendingProdMigrations(
    local,
    parseAppliedMigrationNames(result.stdout.toString("utf8")),
  );
}

export function applyProdMigrations(apiDir: string, wranglerBin: string): void {
  if (inspectProdMigrations(apiDir, wranglerBin).length === 0) {
    process.stdout.write("All configured D1 migrations are already applied; no DDL needed.\n");
    return;
  }
  const result = Bun.spawnSync(
    [wranglerBin, "d1", "migrations", "apply", "DB", "--remote", "--env", "prod"],
    { cwd: apiDir, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0)
    throw new Error(`Production D1 migration failed (exit ${result.exitCode}).`);
  const remaining = inspectProdMigrations(apiDir, wranglerBin);
  if (remaining.length > 0) {
    throw new Error(`D1 migrations remain unapplied: ${remaining.join(", ")}`);
  }
}

if (import.meta.main) {
  const apiDir = resolve(decodeURIComponent(new URL("..", import.meta.url).pathname));
  const pending = inspectProdMigrations(apiDir, resolve(apiDir, "node_modules/.bin/wrangler"));
  if (pending.length > 0) {
    throw new Error(
      `Pending production migrations require review before deployment: ${pending.join(", ")}`,
    );
  }
  process.stdout.write(
    "Production migration ledger matches all configured SQL files; no migrations pending.\n",
  );
}
