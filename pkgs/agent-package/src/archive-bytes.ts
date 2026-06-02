import { PACKAGE_CONTENT_TEXT_LIMIT_BYTES } from "./archive-constants";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function textToArchiveBytes(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function readArchiveBytes(
  entries: Record<string, Uint8Array>,
  path: string,
): Uint8Array | null {
  const entry = entries[path];

  if (!entry) {
    return null;
  }

  if (entry.byteLength > PACKAGE_CONTENT_TEXT_LIMIT_BYTES) {
    throw new Error(`Package file ${path} is too large.`);
  }

  return entry;
}

export function readArchiveText(entries: Record<string, Uint8Array>, path: string): string | null {
  const entry = readArchiveBytes(entries, path);

  if (entry === null) {
    return null;
  }

  return utf8Decoder.decode(entry);
}

export function readArchiveJson(entries: Record<string, Uint8Array>, path: string): unknown {
  const text = readArchiveText(entries, path);

  if (text === null) {
    return null;
  }

  return JSON.parse(text);
}
