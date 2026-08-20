import type { ExecutionSessionHandle } from "./sandbox-handles";

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array();
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }

  return bytes;
}

export async function readSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
): Promise<Uint8Array> {
  const file = await handle.readFile(path, { encoding: "base64" });

  if (file.encoding === "base64") {
    return decodeBase64(file.content);
  }

  return new TextEncoder().encode(file.content);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked conversion keeps String.fromCharCode off argument-count limits.
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export async function writeSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await handle.writeFile(path, encodeBase64(bytes), { encoding: "base64" });
}
