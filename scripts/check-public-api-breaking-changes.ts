import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { findOpenApiBreakingChanges } from "../config/public-api-compatibility";
import { PUBLIC_API_OPENAPI_ARTIFACT_PATH } from "./public-api-openapi-artifact";

const BASE_REF = "origin/main";

const base = spawnSync("git", ["show", `${BASE_REF}:${PUBLIC_API_OPENAPI_ARTIFACT_PATH}`], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (base.status !== 0) {
  console.error(
    `Cannot read ${PUBLIC_API_OPENAPI_ARTIFACT_PATH} at ${BASE_REF}: ${base.stderr.trim()}`,
  );
  process.exit(1);
}

const changes = findOpenApiBreakingChanges(
  JSON.parse(base.stdout),
  JSON.parse(await readFile(PUBLIC_API_OPENAPI_ARTIFACT_PATH, "utf8")),
);

if (changes.length > 0) {
  console.error(`Public API v1 has breaking changes against ${BASE_REF}:`);

  for (const change of changes) {
    console.error(`- ${change}`);
  }

  console.error("Use a versioned endpoint or preserve v1 compatibility.");
  process.exit(1);
}

console.log(`Public API OpenAPI is backward compatible with ${BASE_REF}.`);
