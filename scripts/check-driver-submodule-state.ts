import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const driverSubmodulePath = "apps/driver";
const updateCommand = `git submodule update --init --checkout ${driverSubmodulePath}`;

export interface DriverSubmoduleCheckout {
  readonly actualCommit: string;
  readonly expectedCommit: string;
}

function fail(message: string): never {
  throw new Error(`Driver submodule check failed: ${message}`);
}

function readGitOutput(repoRoot: string, args: readonly string[], failureMessage: string): string {
  const result = spawnSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const detail = result.stderr?.trim() ?? result.error?.message ?? "";
    fail(`${failureMessage}${detail.length > 0 ? `\n${detail}` : ""}`);
  }

  const output = result.stdout?.trim() ?? "";

  if (output.length === 0) {
    fail(failureMessage);
  }

  return output;
}

export function validateDriverSubmoduleCheckout(input: DriverSubmoduleCheckout): void {
  if (input.actualCommit === input.expectedCommit) {
    return;
  }

  fail(
    [
      `${driverSubmodulePath} is checked out at the wrong commit.`,
      `Expected: ${input.expectedCommit}`,
      `Actual:   ${input.actualCommit}`,
      `Run: ${updateCommand}`,
    ].join("\n"),
  );
}

export function checkDriverSubmoduleCheckout(repoRoot: string): DriverSubmoduleCheckout {
  const expectedCommit = readGitOutput(
    repoRoot,
    ["rev-parse", `:${driverSubmodulePath}`],
    `${driverSubmodulePath} is not recorded as an initialized gitlink in the repository index.`,
  );
  const actualCommit = readGitOutput(
    repoRoot,
    ["-C", driverSubmodulePath, "rev-parse", "HEAD"],
    `${driverSubmodulePath} is not initialized. Run: ${updateCommand}`,
  );
  const checkout = {
    actualCommit,
    expectedCommit,
  } satisfies DriverSubmoduleCheckout;

  validateDriverSubmoduleCheckout(checkout);
  return checkout;
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const checkout = checkDriverSubmoduleCheckout(repoRoot);
  console.log(`Driver submodule checkout matches ${checkout.expectedCommit}.`);
}
