import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { createPublicApiOpenApiDocument } from "../apps/api/src/adapters/http/routes/public-api-openapi";

export const PUBLIC_API_OPENAPI_ARTIFACT_PATH = "apps/api/openapi/public-api-v1.generated.json";

export function renderPublicApiOpenApiArtifact(): string {
  return `${JSON.stringify(createPublicApiOpenApiDocument("https://cloud.mosoo.ai"), null, 2)}\n`;
}

function runArtifactFormatter(mode: "--check" | "--write"): void {
  const result = spawnSync("vp", ["fmt", PUBLIC_API_OPENAPI_ARTIFACT_PATH, mode], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to format ${PUBLIC_API_OPENAPI_ARTIFACT_PATH}.`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const expected = renderPublicApiOpenApiArtifact();

  if (mode === "--write") {
    await writeFile(PUBLIC_API_OPENAPI_ARTIFACT_PATH, expected, "utf8");
    runArtifactFormatter("--write");
    console.log(`Wrote ${PUBLIC_API_OPENAPI_ARTIFACT_PATH}.`);
    return;
  }

  if (mode !== "--check") {
    throw new Error("Usage: public-api-openapi-artifact.ts --write|--check");
  }

  const actual = await readFile(PUBLIC_API_OPENAPI_ARTIFACT_PATH, "utf8").catch(() => null);
  let matches = false;

  if (actual !== null) {
    try {
      matches = JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(expected));
    } catch {
      matches = false;
    }
  }

  if (!matches) {
    console.error(
      `Public API OpenAPI artifact is stale. Run \`bun run public-api:openapi:generate\`.`,
    );
    process.exitCode = 1;
    return;
  }

  runArtifactFormatter("--check");
  console.log(`Public API OpenAPI artifact is current: ${PUBLIC_API_OPENAPI_ARTIFACT_PATH}`);
}

if (import.meta.main) {
  await main();
}
