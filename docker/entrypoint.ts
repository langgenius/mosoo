#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, symlink } from "node:fs/promises";

import { buildDevVars, validateWebExposure } from "./runtime-config";

const repositoryRoot = "/app";
const dataDirectory = process.env["MOSOO_DATA_DIR"]?.trim() || "/data";
const persistedDevVarsPath = `${dataDirectory}/.dev.vars`;
const workerDevVarsPath = `${repositoryRoot}/apps/api/.dev.vars`;

function log(message: string): void {
  process.stdout.write(`[mosoo/docker] ${message}\n`);
}

async function readExistingDevVars(): Promise<string> {
  try {
    return await readFile(persistedDevVarsPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeDevVarsAtomically(content: string): Promise<void> {
  const temporaryDevVarsPath = `${persistedDevVarsPath}.tmp-${process.pid}-${randomUUID()}`;
  let renamed = false;
  try {
    const file = await open(temporaryDevVarsPath, "wx", 0o600);
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await chmod(temporaryDevVarsPath, 0o600);
    await rename(temporaryDevVarsPath, persistedDevVarsPath);
    renamed = true;

    const directory = await open(dataDirectory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (!renamed) {
      await rm(temporaryDevVarsPath, { force: true });
    }
  }
}

async function preparePersistentState(): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const existingContent = await readExistingDevVars();
  const built = buildDevVars(existingContent, process.env);
  if (built.content !== existingContent) {
    await writeDevVarsAtomically(built.content);
  }
  await chmod(persistedDevVarsPath, 0o600);

  await rm(workerDevVarsPath, { force: true });
  await symlink(persistedDevVarsPath, workerDevVarsPath);

  if (built.generatedKeys.length > 0) {
    log(`Generated persistent secrets: ${built.generatedKeys.join(", ")}.`);
  }
}

async function runMigration(): Promise<void> {
  log("Applying local D1 migrations.");
  const migration = Bun.spawn(["bun", "run", "--filter", "@mosoo/api", "db:migrate:local"], {
    cwd: repositoryRoot,
    env: process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await migration.exited;
  if (exitCode !== 0) {
    throw new Error(`Local D1 migration failed with exit code ${exitCode}.`);
  }
}

validateWebExposure(process.env);
await preparePersistentState();
await runMigration();

const api = Bun.spawn(["bun", "apps/api/bin/dev-local.ts"], {
  cwd: repositoryRoot,
  env: process.env,
  stderr: "inherit",
  stdout: "inherit",
});
const web = Bun.spawn(["caddy", "run", "--config", `${repositoryRoot}/docker/Caddyfile`], {
  cwd: repositoryRoot,
  env: process.env,
  stderr: "inherit",
  stdout: "inherit",
});

let stopping = false;
function stop(signal: NodeJS.Signals): void {
  if (stopping) {
    return;
  }
  stopping = true;
  api.kill(signal);
  web.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const firstExit = await Promise.race([
  api.exited.then((exitCode) => ({ exitCode, processName: "API" })),
  web.exited.then((exitCode) => ({ exitCode, processName: "web server" })),
]);

if (!stopping) {
  process.stderr.write(
    `[mosoo/docker] ${firstExit.processName} exited unexpectedly with code ${firstExit.exitCode}.\n`,
  );
  stop("SIGTERM");
}

await Promise.allSettled([api.exited, web.exited]);
process.exit(firstExit.exitCode);
