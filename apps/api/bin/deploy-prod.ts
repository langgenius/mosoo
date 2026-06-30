#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");
const apiDir = `${scriptDir}/..`;
const repoRoot = `${apiDir}/../..`;
const D1_BINDING = "DB";
const ENV = "prod";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readD1Results(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Wrangler D1 JSON output must be an array.");
  }

  const [firstResultSet] = value;

  if (!isJsonRecord(firstResultSet)) {
    return [];
  }

  const rows = firstResultSet.results;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row, index) => {
    if (!isJsonRecord(row)) {
      throw new Error(`Wrangler D1 row at index ${index} is not an object.`);
    }

    return row;
  });
}

function readRequiredStringColumn(row: JsonRecord, column: string): string {
  const value = row[column];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected D1 column "${column}" to be a non-empty string.`);
  }

  return value;
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
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

function runJson(args: string[], cwd = apiDir): unknown {
  const result = Bun.spawnSync([wranglerBin, ...args], { cwd });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `wrangler ${args.join(" ")} exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }

  const match = /\[[\s\S]*\][\s]*$/.exec(stdout);
  if (!match) {
    throw new Error(`No JSON in wrangler output:\n${stdout}`);
  }

  const parsed: unknown = JSON.parse(match[0]);
  return parsed;
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

async function withSqlFile<T>(sql: string, fn: (path: string) => T | Promise<T>): Promise<T> {
  const tmpFile = `/tmp/d1-${Date.now()}-${crypto.randomUUID()}.sql`;
  await Bun.write(tmpFile, sql);
  try {
    return await fn(tmpFile);
  } finally {
    try {
      await Bun.file(tmpFile).delete();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeStderr(`warning: unable to delete temp SQL file ${tmpFile}: ${message}`);
    }
  }
}

function d1Query(sql: string): JsonRecord[] {
  const response = runJson([
    "d1",
    "execute",
    D1_BINDING,
    "--env",
    ENV,
    "--remote",
    "--command",
    sql,
    "--json",
  ]);
  return readD1Results(response);
}

function listProdTables(): string[] {
  const rows = d1Query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'cf_%' ORDER BY name",
  );
  return rows.map((row) => readRequiredStringColumn(row, "name"));
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function wipeProdD1(): Promise<void> {
  const tables = listProdTables();

  if (tables.length === 0) {
    writeStdout("  D1 already empty");
    return;
  }

  const sql = [
    "PRAGMA foreign_keys=OFF;",
    ...tables.map((table) => `DROP TABLE IF EXISTS ${quoteSqlIdentifier(table)};`),
    "PRAGMA foreign_keys=ON;",
  ].join("\n");

  await withSqlFile(sql, (file) => {
    run(["d1", "execute", D1_BINDING, "--env", ENV, "--remote", "--file", file]);
  });
  writeStdout(`  dropped ${tables.length} table(s)`);
}

function applyD1Migrations(): void {
  run(["d1", "migrations", "apply", D1_BINDING, "--remote", "--env", ENV]);
}

const CHANNEL_FINAL_DELIVERY_QUEUES: readonly string[] = [
  "channel-final-delivery",
  "channel-final-delivery-dlq",
];

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

function ensureChannelFinalDeliveryQueues(): void {
  const listing = listProdQueues();
  for (const queueName of CHANNEL_FINAL_DELIVERY_QUEUES) {
    ensureQueueExists(queueName, listing);
  }
}

writeStdout("▶ Wiping prod D1 tables");
await wipeProdD1();

writeStdout("▶ Applying current D1 migrations");
applyD1Migrations();

writeStdout("▶ Ensuring channel-final-delivery queues exist");
ensureChannelFinalDeliveryQueues();

writeStdout("▶ Building driver");
runVp(["run", "--filter", "agent-driver", "build"]);

writeStdout("▶ Deploying worker");
run(["deploy", "--env", ENV, "--minify"]);

writeStdout("✓ deploy complete");
