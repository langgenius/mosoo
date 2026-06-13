import { spawnSync } from "node:child_process";
import { stdin } from "node:process";
import { createInterface } from "node:readline";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

async function readPrePushLines(): Promise<string[]> {
  const lines: string[] = [];
  const reader = createInterface({ input: stdin });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
  }

  return lines;
}

async function main(): Promise<void> {
  const lines = await readPrePushLines();

  if (lines.length === 0) {
    return;
  }

  const ranges: string[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const localSha = parts[1];
    const remoteRef = parts[2];
    const remoteSha = parts[3];

    if (!localSha || !remoteRef || !remoteSha) {
      continue;
    }

    if (remoteRef === "refs/heads/main") {
      fail(
        "Direct pushes to main are prohibited. Push a branch and merge it through a pull request.",
      );
    }

    if (isZeroSha(localSha)) {
      continue;
    }

    if (isZeroSha(remoteSha)) {
      ranges.push(localSha);
      continue;
    }

    if (localSha !== remoteSha) {
      ranges.push(`${remoteSha}..${localSha}`);
    }
  }

  if (ranges.length === 0) {
    return;
  }

  for (const range of ranges) {
    const separatorIndex = range.indexOf("..");
    const fromRef = separatorIndex >= 0 ? range.slice(0, separatorIndex) : "";
    const toRef = separatorIndex >= 0 ? range.slice(separatorIndex + 2) : range;

    const result = spawnSync(
      "vp",
      ["exec", "bun", "scripts/validate-commit-range.ts", fromRef, toRef],
      {
        encoding: "utf8",
        stdio: "inherit",
      },
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

await main();
