import { readFile } from "node:fs/promises";

import { OPENAI_APP_SERVER_SCHEMA_VERSION } from "../src/runtimes/openai/generated/app-server-protocol";

async function readPinnedImageVersion(): Promise<string> {
  const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
  const dockerfile = await readFile(dockerfileUrl, "utf8");
  const match = /^ARG OPENAI_RUNTIME_VERSION=(.+)$/m.exec(dockerfile);

  if (!match?.[1]) {
    throw new Error("Docker image is missing OPENAI_RUNTIME_VERSION.");
  }

  return match[1].trim();
}

const imageVersion = await readPinnedImageVersion();

if (imageVersion !== OPENAI_APP_SERVER_SCHEMA_VERSION) {
  throw new Error(
    `OpenAI app-server schema ${OPENAI_APP_SERVER_SCHEMA_VERSION} does not match image ${imageVersion}.`,
  );
}

process.stdout.write(`OpenAI app-server schema ${OPENAI_APP_SERVER_SCHEMA_VERSION} is in sync.\n`);
