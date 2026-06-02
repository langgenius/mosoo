import { readFile, rm } from "node:fs/promises";
import { env, stdin } from "node:process";

import {
  DRIVER_BOOT_PAYLOAD_ENV_NAME,
  DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME,
  parseDriverBootPayloadJson,
} from "@mosoo/driver-protocol";
import type { DriverBootPayload } from "@mosoo/driver-protocol";

function decodeStdinChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }

  throw new Error(`Unsupported driver boot payload chunk type: ${typeof chunk}.`);
}

export async function readDriverBootPayload(): Promise<DriverBootPayload> {
  const envPayload = env[DRIVER_BOOT_PAYLOAD_ENV_NAME];

  if (envPayload !== undefined) {
    const trimmedEnvPayload = envPayload.trim();

    if (trimmedEnvPayload.length > 0) {
      return parseDriverBootPayloadJson(trimmedEnvPayload);
    }
  }

  const payloadFile = env[DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]?.trim();

  if (payloadFile !== undefined && payloadFile.length > 0) {
    const rawPayload = await readFile(payloadFile, "utf8");
    await rm(payloadFile, { force: true });
    return parseDriverBootPayloadJson(rawPayload.trim());
  }

  const chunks: string[] = [];

  for await (const chunk of stdin) {
    chunks.push(decodeStdinChunk(chunk));
  }

  return parseDriverBootPayloadJson(chunks.join("").trim());
}
