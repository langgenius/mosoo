export const MAX_ENTRY_COUNT = 256;
export const MAX_SKILL_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_SKILL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
export const MAX_SKILL_UPLOAD_BYTES = 10 * 1024 * 1024;

export const SKILL_ARCHIVE_EXTRACT_OPTIONS = {
  maxEntryCount: MAX_ENTRY_COUNT,
  maxFileBytes: MAX_SKILL_ENTRY_BYTES,
  maxTotalFileBytes: MAX_SKILL_UNCOMPRESSED_BYTES,
};

export class SkillRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SkillRequestError";
    this.status = status;
  }
}

export interface UploadSkillFile {
  bytes: Uint8Array;
  name: string;
}

export interface InspectSkillInput {
  file?: UploadSkillFile;
  githubUrl?: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer =
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : Uint8Array.from(bytes).buffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function inferMimeType(path: string): string | null {
  if (path.endsWith("/")) {
    return null;
  }

  const lower = path.toLowerCase();

  if (lower.endsWith(".md")) {
    return "text/markdown";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "application/yaml";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".ts")) {
    return "text/plain";
  }
  if (lower.endsWith(".tsx")) {
    return "text/plain";
  }
  if (lower.endsWith(".js")) {
    return "text/plain";
  }
  if (lower.endsWith(".mjs")) {
    return "text/plain";
  }
  if (lower.endsWith(".cjs")) {
    return "text/plain";
  }
  if (lower.endsWith(".sh")) {
    return "text/plain";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}
