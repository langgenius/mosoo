import { ignorePromiseRejection } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";

import type { ExecutionSessionHandle } from "./sandbox-handles";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

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

function encodeBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return "";
  }

  const chunkSize = 0x80_00;
  let binary = "";

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCodePoint(...chunk);
  }

  return btoa(binary);
}

function getParentDirectory(path: string): string {
  const parts = path.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "/";
  }

  return `/${parts.slice(0, -1).join("/")}`;
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

export async function writeSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const parentPath = getParentDirectory(path);
  const temporaryPath = `${parentPath}/.mosoo-write-${createPlatformId()}.b64`;
  const quotedParentPath = quoteShellArg(parentPath);
  const quotedPath = quoteShellArg(path);
  const quotedTemporaryPath = quoteShellArg(temporaryPath);

  await handle.mkdir(parentPath, { recursive: true });
  await handle.writeFile(temporaryPath, encodeBase64(bytes));

  const command = [
    `mkdir -p ${quotedParentPath}`,
    `base64 -d ${quotedTemporaryPath} > ${quotedPath}`,
    `rm -f ${quotedTemporaryPath}`,
  ].join(" && ");
  const result = await handle.exec(`sh -lc ${quoteShellArg(command)}`);

  if (!result.success || result.exitCode !== 0) {
    await handle.exec(`rm -f ${quotedTemporaryPath}`).catch(ignorePromiseRejection);
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `Failed to write sandbox file ${path}.`,
    );
  }
}
