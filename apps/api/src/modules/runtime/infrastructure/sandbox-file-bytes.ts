import { fromBase64, toBase64 } from "../../../shared/bytes";
import type { ExecutionSessionHandle } from "./sandbox-handles";

export async function readSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
): Promise<Uint8Array> {
  const file = await handle.readFile(path, { encoding: "base64" });

  if (file.encoding === "base64") {
    return fromBase64(file.content);
  }

  return new TextEncoder().encode(file.content);
}

export async function writeSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await handle.writeFile(path, toBase64(bytes), { encoding: "base64" });
}
