import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { CommitIdentity } from "../config/commit-policy.ts";
import {
  formatViolations,
  parseGitIdentity,
  validateCommitMetadata,
} from "../config/commit-policy.ts";

type GitIdentityVariable = "GIT_AUTHOR_IDENT" | "GIT_COMMITTER_IDENT";

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

  return result.stdout.trim();
}

export function readResolvedGitIdentity(
  identityVariable: GitIdentityVariable,
  run: (args: readonly string[]) => string = runGit,
): CommitIdentity | null {
  return parseGitIdentity(run(["var", identityVariable]));
}

function readRequiredGitIdentity(identityVariable: GitIdentityVariable): CommitIdentity {
  const identity = readResolvedGitIdentity(identityVariable);
  if (!identity || identity.name.length === 0 || identity.email.length === 0) {
    fail(
      `Git identity ${identityVariable} is missing or invalid. Configure Git identity before committing.`,
    );
  }

  return identity;
}

function main(): void {
  const commitMessageFile = process.argv[2];

  if (!commitMessageFile) {
    fail("Usage: validate-commit-message.ts <commit-message-file>");
  }

  const message = readFileSync(commitMessageFile, "utf8");
  const author = readRequiredGitIdentity("GIT_AUTHOR_IDENT");
  const committer = readRequiredGitIdentity("GIT_COMMITTER_IDENT");

  const violations = validateCommitMetadata({
    authorName: author.name,
    authorEmail: author.email,
    committerName: committer.name,
    committerEmail: committer.email,
    message,
  });

  if (violations.length > 0) {
    fail(
      [
        "Commit rejected by repository policy.",
        "",
        formatViolations(violations),
        "",
        "Format: type(scope): subject",
        "Example: feat(web): add in-app help search",
        "Use a real human author identity; do not attribute commits to AI tools, bots, or automation accounts.",
      ].join("\n"),
    );
  }
}

if (import.meta.main) {
  main();
}
