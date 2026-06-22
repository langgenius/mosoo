import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { e2eCases } from "./cases";
import type { E2ECase, E2ECommand } from "./cases";
import { matchE2ERunTarget } from "./cli-targets";
import { loadRepoEnv } from "./env";

const HELP_ARGS = new Set(["", "-h", "--help", "help"]);

function printHelp(): void {
  const rows = e2eCases
    .toSorted((left, right) => left.id.join(" ").localeCompare(right.id.join(" ")))
    .map((entry) => ({
      command: entry.id.join(" "),
      description: entry.description,
      layer: entry.layer,
    }));
  const commandWidth = Math.max(...rows.map((row) => row.command.length), "Command".length);
  const layerWidth = Math.max(...rows.map((row) => row.layer.length), "Layer".length);
  const descriptionWidth = Math.max(
    ...rows.map((row) => row.description.length),
    "Description".length,
  );

  console.log("Usage:");
  console.log("  just e2e <layer|case> [args...]");
  console.log("");
  console.log("Layers:");

  for (const layer of [...new Set(e2eCases.map((entry) => entry.layer))].toSorted()) {
    console.log(`  ${layer}`);
  }

  console.log("");
  console.log("Cases:");

  const header = `  ${"Command".padEnd(commandWidth)}  ${"Layer".padEnd(
    layerWidth,
  )}  ${"Description".padEnd(descriptionWidth)}`;

  console.log(header);

  for (const row of rows) {
    console.log(
      `  ${row.command.padEnd(commandWidth)}  ${row.layer.padEnd(layerWidth)}  ${row.description.padEnd(
        descriptionWidth,
      )}`,
    );
  }
}

function isMetadataOnlyRun(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--list" || arg === "-h" || arg === "--help");
}

function hasEnvGroup(group: string): boolean {
  return group.split("|").some((name) => (process.env[name]?.trim() ?? "").length > 0);
}

function requireCaseEnv(entry: E2ECase): void {
  const missing = (entry.requiresEnv ?? []).filter((group) => !hasEnvGroup(group));

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    [
      `E2E case '${entry.id.join(" ")}' is missing required environment.`,
      ...missing.map((group) => `  ${group}`),
      "Set values in .env or the shell, then rerun.",
    ].join("\n"),
  );
}

async function ensurePlaywrightInstalled(command: E2ECommand): Promise<void> {
  if (!command.command.includes("playwright") || existsSync(command.command)) {
    return;
  }

  await runCommand({
    args: ["install"],
    command: resolve("node_modules/.bin/vp"),
    cwd: "e2e",
  });
}

async function runCommand(
  command: E2ECommand,
  passthroughArgs: readonly string[] = [],
): Promise<void> {
  await ensurePlaywrightInstalled(command);

  const spawned = Bun.spawn({
    cmd: [command.command, ...command.args, ...passthroughArgs],
    env: {
      ...process.env,
      ...command.env,
    },
    ...(command.cwd ? { cwd: command.cwd } : {}),
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await spawned.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.command}`);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const firstArg = args[0] ?? "";

  loadRepoEnv();

  if (HELP_ARGS.has(firstArg) && args.length <= 1) {
    printHelp();
    return;
  }

  const matched = matchE2ERunTarget(e2eCases, args);

  if (matched === null) {
    console.error(`Unknown E2E target: ${args.join(" ") || "(empty)"}`);
    console.error("");
    printHelp();
    process.exit(2);
  }

  const metadataOnly = isMetadataOnlyRun(matched.args);

  for (const entry of matched.entries) {
    if (matched.entries.length > 1) {
      console.log(`\n[e2e] ${entry.id.join(" ")}`);
    }

    if (!metadataOnly) {
      requireCaseEnv(entry);

      for (const setup of entry.setup ?? []) {
        await runCommand(setup);
      }
    }

    await runCommand(entry.command, matched.args);
  }
}

await main();
