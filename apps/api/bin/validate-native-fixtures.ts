#!/usr/bin/env bun
/**
 * Phase 0 exit artifact for the Mosoo Native Deployment Protocol.
 *
 * Runs validateNativeDeployment over every contract repo fixture, prints one
 * `green|red  <name>  [codes]` line per fixture, and exits non-zero when any
 * fixture's verdict or produced code list drifts from the pinned expectation.
 *
 * Run with: `bun run native:demo` (from apps/api).
 */
import { NATIVE_REPO_FIXTURE_CASES } from "@mosoo/contracts/native-repo-fixtures";

import { validateNativeDeployment } from "../src/modules/apps/application/native-deployment-validator";

const SAMPLE_FIXTURE_NAME = "valid-single-agent-with-sidecar-setup";

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

const nameWidth = Math.max(
  ...NATIVE_REPO_FIXTURE_CASES.map((fixtureCase) => fixtureCase.name.length),
);
let mismatchCount = 0;

for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
  const result = validateNativeDeployment({ files: fixtureCase.files });
  const verdict = result.valid ? "green" : "red";
  const producedCodes = result.failures.map((failure) => failure.code).toSorted();
  const expectedCodes = [...fixtureCase.expectedCodes];
  const matches =
    verdict === fixtureCase.expect && producedCodes.join(",") === expectedCodes.join(",");

  if (!matches) {
    mismatchCount += 1;
  }

  writeStdout(
    `${matches ? "ok  " : "FAIL"}  ${verdict.padEnd(5)}  ${fixtureCase.name.padEnd(nameWidth)}  [${producedCodes.join(", ")}]`,
  );

  if (!matches) {
    writeStdout(`      expected ${fixtureCase.expect} [${expectedCodes.join(", ")}]`);
  }
}

const sampleCase = NATIVE_REPO_FIXTURE_CASES.find(
  (fixtureCase) => fixtureCase.name === SAMPLE_FIXTURE_NAME,
);

if (sampleCase !== undefined) {
  writeStdout("");
  writeStdout(`sample validate result (${sampleCase.name}):`);
  writeStdout(JSON.stringify(validateNativeDeployment({ files: sampleCase.files }), null, 2));
}

if (mismatchCount > 0) {
  writeStdout("");
  writeStdout(`${mismatchCount} fixture(s) drifted from the pinned expectations`);
  process.exit(1);
}

writeStdout("");
writeStdout(`all ${NATIVE_REPO_FIXTURE_CASES.length} fixtures match their pinned expectations`);
