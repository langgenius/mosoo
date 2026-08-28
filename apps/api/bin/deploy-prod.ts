#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";
import {
  extractTableNames,
  findMissingProdTables,
  getLatestSnapshotFilename,
  parseExpectedTableNames,
} from "./prod-schema-guard";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");
const apiDir = `${scriptDir}/..`;
const repoRoot = `${apiDir}/../..`;
const D1_BINDING = "DB";
const ENV = "prod";

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

const wranglerBin = `${apiDir}/node_modules/.bin/wrangler`;
const vpBin = `${repoRoot}/node_modules/.bin/vp`;

function run(args: string[], cwd = apiDir): void {
  const result = Bun.spawnSync([wranglerBin, ...args], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

function runVp(args: string[], cwd = repoRoot): void {
  const result = Bun.spawnSync([vpBin, ...args], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

function applyD1Migrations(): void {
  run(["d1", "migrations", "apply", D1_BINDING, "--remote", "--env", ENV]);
}

const MIGRATION_META_DIR = `${repoRoot}/pkgs/db/drizzle/meta`;

/**
 * Refuse to deploy a Worker whose schema references tables missing from prod.
 * Runs AFTER `applyD1Migrations`, so on the correct append-only path every
 * table is already present (DEPLOY-D1-001).
 */
async function loadExpectedMigrationTables(): Promise<string[]> {
  const journal = await Bun.file(`${MIGRATION_META_DIR}/_journal.json`).text();
  const snapshotFilename = getLatestSnapshotFilename(journal);
  const snapshot = await Bun.file(`${MIGRATION_META_DIR}/${snapshotFilename}`).text();

  return parseExpectedTableNames(snapshot);
}

async function assertProdSchemaMatchesMigrations(expectedTables: readonly string[]): Promise<void> {
  const result = Bun.spawnSync(
    [
      wranglerBin,
      "d1",
      "execute",
      D1_BINDING,
      "--remote",
      "--env",
      ENV,
      "--json",
      "--command",
      "SELECT name FROM sqlite_master WHERE type='table'",
    ],
    { cwd: apiDir },
  );
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `wrangler d1 execute (schema check) exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }

  const missingTables = findMissingProdTables(expectedTables, extractTableNames(stdout));

  if (missingTables.length > 0) {
    throw new Error(
      [
        "✗ Prod D1 schema drift: the latest migration snapshot defines tables absent from prod.",
        `  Missing: ${missingTables.join(", ")}`,
        "  Cause: a migration expected to create a table was skipped, rewritten,",
        "  or incomplete (DEPLOY-D1-001). Fix the history with a new reviewed",
        "  migration; never rewrite an applied migration, then re-run the deploy.",
      ].join("\n"),
    );
  }

  writeStdout(`  prod schema OK (${expectedTables.length} migration tables present)`);
}

const REQUIRED_PROD_QUEUES: readonly string[] = ["environment-artifact-build"];

function listProdQueues(): string[] {
  const result = Bun.spawnSync([wranglerBin, "queues", "list"], { cwd: apiDir });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `wrangler queues list exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineContainsQueueName(line: string, queueName: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRegExp(queueName)}([^\\w-]|$)`).test(line);
}

function ensureQueueExists(queueName: string, existingQueues: readonly string[]): void {
  if (existingQueues.some((line) => lineContainsQueueName(line, queueName))) {
    writeStdout(`  queue ${queueName} already exists`);
    return;
  }

  const result = Bun.spawnSync([wranglerBin, "queues", "create", queueName], {
    cwd: apiDir,
  });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode === 0) {
    writeStdout(`  created queue ${queueName}`);
    return;
  }

  const combined = `${stderr}\n${stdout}`.toLowerCase();
  if (combined.includes("already exists")) {
    writeStdout(`  queue ${queueName} already exists`);
    return;
  }

  throw new Error(
    `wrangler queues create ${queueName} exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
  );
}

function ensureRequiredProdQueues(): void {
  const listing = listProdQueues();
  for (const queueName of REQUIRED_PROD_QUEUES) {
    ensureQueueExists(queueName, listing);
  }
}

const expectedMigrationTables = await loadExpectedMigrationTables().catch((error: unknown) => {
  writeStdout(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

writeStdout("▶ Applying pending D1 migrations");
applyD1Migrations();

writeStdout("▶ Verifying prod D1 schema matches the latest migration snapshot");
await assertProdSchemaMatchesMigrations(expectedMigrationTables).catch((error: unknown) => {
  writeStdout(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

writeStdout("▶ Ensuring required production queues exist");
ensureRequiredProdQueues();

writeStdout("▶ Building driver");
runVp(["run", "--filter", "agent-driver", "build"]);

writeStdout("▶ Deploying worker");
run(["deploy", "--env", ENV, "--minify", "--containers-rollout", "immediate"]);

writeStdout("✓ deploy complete");
