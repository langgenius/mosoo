import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import type { PublicApiVersion } from "@mosoo/contracts/public-api";

import { createPublicApiOpenApiDocument } from "../apps/api/src/adapters/http/routes/public-api-openapi";

export const PUBLIC_API_OPENAPI_ARTIFACT_PATH = "apps/api/openapi/public-api-v1.generated.json";

export function renderPublicApiOpenApiArtifact(version: PublicApiVersion = "v1"): string {
  return `${JSON.stringify(createPublicApiOpenApiDocument("https://cloud.mosoo.ai", version), null, 2)}\n`;
}

function runArtifactFormatter(path: string, mode: "--check" | "--write"): void {
  const result = spawnSync("vp", ["fmt", path, mode], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to format ${path}.`);
  }
}

async function updateArtifact(
  version: PublicApiVersion,
  mode: "--check" | "--write",
): Promise<void> {
  const path = `apps/api/openapi/public-api-${version}.generated.json`;
  const expected = renderPublicApiOpenApiArtifact(version);

  if (mode === "--write") {
    await writeFile(path, expected, "utf8");
    runArtifactFormatter(path, "--write");
    console.log(`Wrote ${path}.`);
    return;
  }

  const actual = await readFile(path, "utf8").catch(() => null);
  let matches = false;

  if (actual !== null) {
    try {
      matches = JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(expected));
    } catch {
      matches = false;
    }
  }

  if (!matches) {
    console.error(`${path} is stale. Run \`just public-api-openapi\`.`);
    process.exitCode = 1;
    return;
  }

  runArtifactFormatter(path, "--check");
  console.log(`Public API OpenAPI artifact is current: ${path}`);
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--write")
    throw new Error("Usage: public-api-openapi-artifact.ts --write|--check");
  for (const version of ["v1", "v2"] as const) await updateArtifact(version, mode);
}
