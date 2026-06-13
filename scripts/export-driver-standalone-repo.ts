import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const driverEntries = [
  ".dockerignore",
  ".github",
  ".gitignore",
  "Dockerfile",
  "README.md",
  "bin",
  "package.json",
  "src",
  "tests",
  "tsconfig.json",
  "tsconfig.types.json",
] as const;

interface ExportOptions {
  readonly force: boolean;
  readonly remoteUrl: string | null;
  readonly runSmoke: boolean;
  readonly target: string;
}

function fail(message: string): never {
  throw new Error(`Driver standalone repo export failed: ${message}`);
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    const output = result.stdout.trim();
    const details = output.length > 0 ? `\n${output}` : "";
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? "unknown"}.${details}`);
  }

  return result.stdout;
}

function readPackageName(packageRoot: string): string {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    readonly name?: unknown;
  };

  if (packageJson.name !== "agent-driver") {
    fail(`driver package name must be agent-driver, got ${String(packageJson.name)}.`);
  }

  return packageJson.name;
}

function parseOptions(argv: readonly string[]): ExportOptions {
  let force = false;
  let remoteUrl: string | null = null;
  let runSmoke = false;
  let target: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--smoke") {
      runSmoke = true;
      continue;
    }

    if (arg === "--remote") {
      const value = argv[index + 1];

      if (!value) {
        fail("--remote requires a URL.");
      }

      remoteUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--target") {
      const value = argv[index + 1];

      if (!value) {
        fail("--target requires a path.");
      }

      target = resolve(value);
      index += 1;
      continue;
    }

    fail(`unknown argument ${arg}.`);
  }

  return {
    force,
    remoteUrl,
    runSmoke,
    target: target ?? mkdtempSync(join(tmpdir(), "moso-agent-driver-")),
  };
}

function prepareTarget(target: string, force: boolean): void {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    return;
  }

  const entries = readdirSync(target);

  if (entries.length === 0) {
    return;
  }

  if (!force) {
    fail(`${target} already exists and is not empty. Pass --force to replace it.`);
  }

  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
}

function copyDriverTree(sourceRoot: string, destinationRoot: string): void {
  for (const entry of driverEntries) {
    const source = join(sourceRoot, entry);

    if (!existsSync(source)) {
      fail(`driver tree is missing ${entry}.`);
    }

    cpSync(source, join(destinationRoot, entry), { recursive: true });
  }
}

function initializeRepository(target: string, remoteUrl: string | null): void {
  run("git", ["init", "-b", "main"], target);
  run("git", ["config", "user.email", "driver-export@example.invalid"], target);
  run("git", ["config", "user.name", "Driver Export"], target);

  if (remoteUrl !== null) {
    run("git", ["remote", "add", "origin", remoteUrl], target);
  }

  run("git", ["add", "."], target);
  run("git", ["commit", "-m", "chore(driver): seed standalone repository"], target);
}

function runStandaloneSmoke(sourceRoot: string, target: string): void {
  const nodeModules = join(sourceRoot, "node_modules");

  if (!existsSync(nodeModules)) {
    fail("apps/driver/node_modules is missing; run bun install before standalone export smoke.");
  }

  symlinkSync(nodeModules, join(target, "node_modules"), "dir");
  run("bun", ["run", "ci"], target);
  rmSync(join(target, "node_modules"), { force: true, recursive: true });
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const driverSourceRoot = join(repoRoot, "apps/driver");
const options = parseOptions(process.argv.slice(2));

readPackageName(driverSourceRoot);
prepareTarget(options.target, options.force);
copyDriverTree(driverSourceRoot, options.target);
initializeRepository(options.target, options.remoteUrl);

if (options.runSmoke) {
  runStandaloneSmoke(driverSourceRoot, options.target);
}

const head = run("git", ["rev-parse", "HEAD"], options.target).trim();

console.log(`Driver standalone repo exported to ${options.target}.`);
console.log(`Driver standalone repo HEAD ${head}.`);
