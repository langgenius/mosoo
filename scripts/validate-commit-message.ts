import { readFileSync } from "node:fs";

import { formatViolations, validateCommitMessage } from "../config/commit-policy.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const commitMessageFile = process.argv[2];

  if (!commitMessageFile) {
    fail("Usage: validate-commit-message.ts <commit-message-file>");
  }

  const message = readFileSync(commitMessageFile, "utf8");
  const violations = validateCommitMessage(message);

  if (violations.length > 0) {
    fail(
      [
        "Commit message rejected by repository policy.",
        "",
        formatViolations(violations),
        "",
        "Format: type(scope): subject",
        "Example: feat(web): add in-app help search",
      ].join("\n"),
    );
  }
}

main();
