import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { buildSessionIsolationPlan } from "../src/modules/runtime/infrastructure/session-isolation-plan";

function prepare(): void {
  const [inputPath, outputDirectory, ...extra] = process.argv.slice(2);
  if (
    !inputPath ||
    !outputDirectory ||
    extra.length ||
    !isAbsolute(inputPath) ||
    !isAbsolute(outputDirectory)
  ) {
    throw new Error(
      "Usage: just session-isolation-plan <absolute private input.json> <absolute new output directory>",
    );
  }
  const stat = statSync(inputPath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 1_000_000) {
    throw new Error("Input must be a private regular file of at most 1 MB.");
  }
  const input = readFileSync(inputPath, "utf8");
  const plan = buildSessionIsolationPlan(JSON.parse(input));
  const forward = JSON.stringify({ batch: plan.forward }, null, 2) + "\n";
  const rollback = JSON.stringify({ batch: plan.rollback }, null, 2) + "\n";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  mkdirSync(outputDirectory, { mode: 0o700 });
  for (const [name, contents] of [
    ["forward.json", forward],
    ["rollback.json", rollback],
    [
      "state.json",
      JSON.stringify(
        { before: plan.before, after: plan.after, workspaceEvidence: plan.workspaceEvidence },
        null,
        2,
      ) + "\n",
    ],
    [
      "review.json",
      JSON.stringify(
        {
          preparedAt: new Date().toISOString(),
          inputSha256: hash(input),
          forwardSha256: hash(forward),
          rollbackSha256: hash(rollback),
          forwardStatements: plan.forward.length,
          rollbackStatements: plan.rollback.length,
          remoteActions: 0,
          requiresVerifiedObjectsAndApprovedTarget: true,
        },
        null,
        2,
      ) + "\n",
    ],
  ] as const) {
    writeFileSync(join(outputDirectory, name), contents, { flag: "wx", mode: 0o600 });
  }
  console.log(
    `Prepared private transition and rollback batches in ${outputDirectory}. No remote action was performed.`,
  );
}

try {
  prepare();
} catch {
  // Parser/database material can contain customer configuration. Keep it out of
  // terminal logs; qualification errors can be inspected on the private input.
  console.error(
    "Session isolation plan preparation failed. Check the private input and output path against docs/session-isolation-transition.md; no remote action was performed.",
  );
  process.exitCode = 1;
}
