import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  findOpenApiBreakingChanges,
  validateOpenApiBreakingChangeApproval,
} from "../config/public-api-compatibility";
import { PUBLIC_API_OPENAPI_ARTIFACT_PATH } from "./public-api-openapi-artifact";

const APPROVALS_PATH = "config/public-api-v1-breaking-change-approvals.json";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runGit(args: string[]): string | null {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0 ? result.stdout : null;
}

function normalizedDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readApprovals(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${APPROVALS_PATH} must contain an object.`);
  }

  const approvals = (value as Record<string, unknown>)["approvals"];

  if (!Array.isArray(approvals)) {
    fail(`${APPROVALS_PATH} must contain an approvals array.`);
  }

  return approvals;
}

const baseRef = process.env["PUBLIC_API_OPENAPI_BASE_REF"]?.trim() || "origin/main";

if (runGit(["rev-parse", "--verify", baseRef]) === null) {
  fail(`Cannot resolve Public API compatibility base ref ${baseRef}.`);
}

const currentText = await readFile(PUBLIC_API_OPENAPI_ARTIFACT_PATH, "utf8");
const currentDocument: unknown = JSON.parse(currentText);
const baseText = runGit(["show", `${baseRef}:${PUBLIC_API_OPENAPI_ARTIFACT_PATH}`]);

if (baseText === null) {
  console.log(
    `No ${PUBLIC_API_OPENAPI_ARTIFACT_PATH} exists at ${baseRef}; seeding the v1 compatibility baseline.`,
  );
  process.exit(0);
}

const baseDocument: unknown = JSON.parse(baseText);
const changes = findOpenApiBreakingChanges(baseDocument, currentDocument);

if (changes.length === 0) {
  console.log(`Public API OpenAPI is backward compatible with ${baseRef}.`);
  process.exit(0);
}

const baselineSha256 = normalizedDigest(baseDocument);
const approvals = readApprovals(JSON.parse(await readFile(APPROVALS_PATH, "utf8")));
const unapproved: string[] = [];

for (const change of changes) {
  const candidates = approvals.filter(
    (approval) =>
      typeof approval === "object" &&
      approval !== null &&
      !Array.isArray(approval) &&
      (approval as Record<string, unknown>)["change"] === change,
  );
  const valid = candidates.find(
    (approval) => validateOpenApiBreakingChangeApproval(approval, baselineSha256).length === 0,
  );

  if (!valid) {
    unapproved.push(change);
  }
}

if (unapproved.length > 0) {
  console.error(`Public API v1 has unapproved breaking changes against ${baseRef}:`);

  for (const change of unapproved) {
    console.error(`- ${change}`);
  }

  console.error(
    `Use a versioned endpoint, preserve v1 compatibility, or record a staged rollout in ${APPROVALS_PATH} bound to baseline ${baselineSha256}.`,
  );
  process.exit(1);
}

console.log(
  `Public API v1 breaking changes have staged approvals bound to baseline ${baselineSha256}.`,
);
