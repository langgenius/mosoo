import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const driverEntries = [
  ".dockerignore",
  ".github",
  ".gitignore",
  "Dockerfile",
  "README.md",
  "package.json",
  "src",
  "tests",
  "tsconfig.json",
  "tsconfig.types.json",
] as const;

const expectedDriverRepoUrl = "https://github.com/langgenius/mosoo-agent-driver.git";

function fail(message: string): never {
  throw new Error(`Driver submodule cutover smoke failed: ${message}`);
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

function copyDriverTree(sourceRoot: string, destinationRoot: string): void {
  mkdirSync(destinationRoot, { recursive: true });

  for (const entry of driverEntries) {
    const source = join(sourceRoot, entry);

    if (!existsSync(source)) {
      fail(`driver tree is missing ${entry}.`);
    }

    cpSync(source, join(destinationRoot, entry), { recursive: true });
  }
}

function initializeRepository(path: string): void {
  run("git", ["init"], path);
  run("git", ["config", "user.email", "driver-submodule-smoke@example.invalid"], path);
  run("git", ["config", "user.name", "Driver Submodule Smoke"], path);
  run("git", ["add", "."], path);
  run("git", ["commit", "-m", "chore(driver): seed standalone smoke repo"], path);
}

function readPackageName(packageRoot: string): string {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    readonly name?: unknown;
  };

  if (packageJson.name !== "@mosoo/agent-driver") {
    fail(`driver package name must be @mosoo/agent-driver, got ${String(packageJson.name)}.`);
  }

  return packageJson.name;
}

function verifyCurrentMainRepoPin(repoRoot: string): void {
  const gitmodules = readFileSync(join(repoRoot, ".gitmodules"), "utf8");

  if (
    !gitmodules.includes('[submodule "apps/driver"]') ||
    !gitmodules.includes("path = apps/driver") ||
    !gitmodules.includes(`url = ${expectedDriverRepoUrl}`)
  ) {
    fail(".gitmodules must pin apps/driver to the standalone driver repository.");
  }

  const gitlink = run("git", ["ls-files", "-s", "apps/driver"], repoRoot).trim();

  if (!gitlink.startsWith("160000 ")) {
    fail(`apps/driver must be tracked by the main repository as a gitlink, got:\n${gitlink}`);
  }

  const currentDriverRemote = run(
    "git",
    ["-C", "apps/driver", "remote", "get-url", "origin"],
    repoRoot,
  ).trim();

  if (currentDriverRemote !== expectedDriverRepoUrl) {
    fail(`apps/driver origin must be ${expectedDriverRepoUrl}, got ${currentDriverRemote}.`);
  }
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const driverSourceRoot = join(repoRoot, "apps/driver");
const tempRoot = mkdtempSync(join(tmpdir(), "driver-submodule-cutover-smoke-"));

try {
  const driverRepo = join(tempRoot, "mosoo-agent-driver");
  const mainRepo = join(tempRoot, "mosoo-main");
  const clonedMainRepo = join(tempRoot, "mosoo-main-clone");

  verifyCurrentMainRepoPin(repoRoot);
  readPackageName(driverSourceRoot);
  copyDriverTree(driverSourceRoot, driverRepo);
  initializeRepository(driverRepo);

  mkdirSync(mainRepo, { recursive: true });
  run("git", ["init"], mainRepo);
  run("git", ["config", "user.email", "main-submodule-smoke@example.invalid"], mainRepo);
  run("git", ["config", "user.name", "Main Submodule Smoke"], mainRepo);
  writeFileSync(
    join(mainRepo, "package.json"),
    JSON.stringify(
      {
        name: "mosoo-submodule-smoke",
        packageManager: "bun@1.3.14",
        private: true,
        scripts: {
          "driver:checkout-smoke": "bun --cwd apps/driver run tc",
        },
        type: "module",
        workspaces: ["apps/*"],
      },
      null,
      2,
    ),
    "utf8",
  );
  run("git", ["add", "package.json"], mainRepo);
  run("git", ["commit", "-m", "chore(driver): seed main smoke repo"], mainRepo);
  run(
    "git",
    ["-c", "protocol.file.allow=always", "submodule", "add", driverRepo, "apps/driver"],
    mainRepo,
  );
  run("git", ["add", ".gitmodules", "apps/driver"], mainRepo);
  run("git", ["commit", "-m", "chore(driver): pin driver submodule"], mainRepo);

  const gitlink = run("git", ["ls-files", "-s", "apps/driver"], mainRepo).trim();

  if (!gitlink.startsWith("160000 ")) {
    fail(`apps/driver must be tracked as a gitlink, got:\n${gitlink}`);
  }

  const copiedSource = run("git", ["ls-files", "apps/driver/package.json"], mainRepo).trim();

  if (copiedSource.length > 0) {
    fail(`main repository must not track copied driver source files:\n${copiedSource}`);
  }

  const status = run("git", ["submodule", "status", "--recursive"], mainRepo).trim();

  if (!status.includes("apps/driver")) {
    fail(`submodule status did not include apps/driver:\n${status}`);
  }

  const gitmodules = readFileSync(join(mainRepo, ".gitmodules"), "utf8");

  if (!gitmodules.includes("path = apps/driver") || !gitmodules.includes(driverRepo)) {
    fail(".gitmodules does not pin apps/driver to the driver repository.");
  }

  const nodeModules = join(driverSourceRoot, "node_modules");

  if (!existsSync(nodeModules)) {
    fail("apps/driver/node_modules is missing; run bun install before submodule smoke.");
  }

  run("git", ["clone", mainRepo, clonedMainRepo], tempRoot);
  run(
    "git",
    ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"],
    clonedMainRepo,
  );

  const clonedSubmodulePath = join(clonedMainRepo, "apps/driver");

  symlinkSync(nodeModules, join(clonedSubmodulePath, "node_modules"), "dir");
  run("bun", ["run", "driver:checkout-smoke"], clonedMainRepo);

  writeFileSync(join(driverRepo, ".submodule-smoke-version"), "2\n", "utf8");
  run("git", ["add", ".submodule-smoke-version"], driverRepo);
  run("git", ["commit", "-m", "chore(driver): simulate driver submodule bump"], driverRepo);
  const bumpedDriverCommit = run("git", ["rev-parse", "HEAD"], driverRepo).trim();

  run("git", ["-C", "apps/driver", "fetch", "origin"], clonedMainRepo);
  run("git", ["-C", "apps/driver", "checkout", bumpedDriverCommit], clonedMainRepo);
  run("git", ["add", "apps/driver"], clonedMainRepo);

  const stagedMainFiles = run("git", ["diff", "--cached", "--name-only"], clonedMainRepo).trim();

  if (stagedMainFiles !== "apps/driver") {
    fail(`driver bump must stage only the submodule gitlink, got:\n${stagedMainFiles}`);
  }

  const bumpedGitlink = run("git", ["ls-files", "-s", "apps/driver"], clonedMainRepo).trim();

  if (!bumpedGitlink.startsWith("160000 ")) {
    fail(`bumped apps/driver must remain a gitlink, got:\n${bumpedGitlink}`);
  }

  run("git", ["config", "user.email", "main-submodule-smoke@example.invalid"], clonedMainRepo);
  run("git", ["config", "user.name", "Main Submodule Smoke"], clonedMainRepo);
  run("git", ["commit", "-m", "chore(driver): bump driver submodule"], clonedMainRepo);

  console.log("Driver submodule cutover smoke passed.");
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
