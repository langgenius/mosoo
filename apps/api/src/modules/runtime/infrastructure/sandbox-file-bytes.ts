import { fromBase64, toBase64 } from "../../../shared/bytes";
import { quoteShellArg } from "../../../shared/shell";
import type { ExecutionSessionHandle } from "./sandbox-handles";

export async function readSandboxFileBytes(
  handle: ExecutionSessionHandle,
  path: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (maxBytes !== undefined) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error("Sandbox file byte limit is invalid.");
    }
    const command = [
      "runtime_file_read=$(mktemp)",
      "trap 'rm -f \"$runtime_file_read\"' EXIT",
      `head -c ${maxBytes + 1} -- ${quoteShellArg(path)} > "$runtime_file_read"`,
      'base64 -w 0 "$runtime_file_read"',
    ].join(" && ");
    const result = await handle.exec(`sh -lc ${quoteShellArg(command)}`);
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || `Failed to read sandbox file ${path}.`,
      );
    }
    return fromBase64(result.stdout);
  }
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
