#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";

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

writeStdout("▶ Applying pending D1 migrations");
applyD1Migrations();

writeStdout("▶ Ensuring channel-final-delivery queues exist");
ensureChannelFinalDeliveryQueues();

writeStdout("▶ Building driver");
runVp(["run", "--filter", "agent-driver", "build"]);

writeStdout("▶ Deploying worker");
run(["deploy", "--env", ENV, "--minify"]);

writeStdout("✓ deploy complete");
