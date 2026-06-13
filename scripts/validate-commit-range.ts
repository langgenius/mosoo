import { spawnSync } from "node:child_process";

import { formatViolations, validateCommitMetadata } from "../config/commit-policy.ts";

interface CommitRecord {
  hash: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  message: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runGit(args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    fail(stderr.length > 0 ? stderr : `git ${args.join(" ")} failed`);
  }

  return result.stdout;
}

function parseCommitRecords(output: string): CommitRecord[] {
  const records: CommitRecord[] = [];
  const blocks = output.split("\x1e").filter((block) => block.length > 0);

  for (const block of blocks) {
    const lines = block.split("\x1f");
    const hash = lines[0]?.trim();
    const authorName = lines[1]?.trim();
    const authorEmail = lines[2]?.trim();
    const committerName = lines[3]?.trim();
    const committerEmail = lines[4]?.trim();
    const message = lines[5] ?? "";

    if (!hash || !authorName || !authorEmail || !committerName || !committerEmail) {
      continue;
    }

    records.push({
      hash,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      message,
    });
  }

  return records;
}

function listCommits(fromRef: string, toRef: string): CommitRecord[] {
  const range = fromRef.length > 0 ? `${fromRef}..${toRef}` : toRef;
  const output = runGit(["log", `--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e`, range]);

  return parseCommitRecords(output);
}

function main(): void {
  const fromRef = process.argv[2]?.trim() ?? "";
  const toRef = process.argv[3]?.trim() ?? "HEAD";

  if (!toRef) {
    fail("Usage: validate-commit-range.ts <from-ref> <to-ref>");
  }

  const commits = listCommits(fromRef, toRef);
  const failures: string[] = [];

  for (const commit of commits) {
    const violations = validateCommitMetadata({
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      committerName: commit.committerName,
      committerEmail: commit.committerEmail,
      message: commit.message,
    });

    if (violations.length === 0) {
      continue;
    }

    failures.push(`commit ${commit.hash.slice(0, 12)}\n${formatViolations(violations)}`);
  }

  if (failures.length > 0) {
    fail(
      [
        "Commit policy check failed.",
        "",
        ...failures,
        "",
        "See CONTRIBUTING.md and config/commit-policy.ts.",
      ].join("\n"),
    );
  }

  console.log(`Commit policy check passed (${commits.length} commit(s)).`);
}

main();
