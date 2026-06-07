import {
  SANDBOX_GLOBAL_SPACE_ROOT,
  SANDBOX_MEMORY_PATH,
  SANDBOX_ORGANIZATION_ROOT,
  isSandboxCachePath,
  isSandboxSessionStatePath,
} from "agent-driver/paths";

import type {
  AgentFileEntryKind,
  AgentFilePersistence,
  AgentFilePreview,
  AgentFileTreeListingEntry,
  ListingParseResult,
} from "./agent-file-browser-model";

export const MAX_DIRECTORY_ENTRIES = 500;
export const LISTING_TOTAL_MARKER = "__MOSOO_TOTAL__";

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".cfg",
  ".cjs",
  ".conf",
  ".css",
  ".dockerfile",
  ".env",
  ".fish",
  ".gitignore",
  ".go",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".kt",
  ".log",
  ".lua",
  ".markdown",
  ".md",
  ".mjs",
  ".proto",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const MIME_BY_EXTENSION = new Map<string, string>([
  [".bash", "text/x-shellscript"],
  [".cfg", "text/plain"],
  [".cjs", "text/javascript"],
  [".conf", "text/plain"],
  [".css", "text/css"],
  [".dockerfile", "text/x-dockerfile"],
  [".env", "text/plain"],
  [".fish", "text/x-shellscript"],
  [".gitignore", "text/plain"],
  [".go", "text/x-go"],
  [".html", "text/html"],
  [".ini", "text/plain"],
  [".java", "text/x-java-source"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".jsonl", "application/x-ndjson"],
  [".jsx", "text/jsx"],
  [".kt", "text/x-kotlin"],
  [".log", "text/plain"],
  [".lua", "text/x-lua"],
  [".markdown", "text/markdown"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".proto", "text/plain"],
  [".py", "text/x-python"],
  [".rb", "text/x-ruby"],
  [".rs", "text/x-rust"],
  [".scss", "text/x-scss"],
  [".sh", "text/x-shellscript"],
  [".sql", "application/sql"],
  [".toml", "application/toml"],
  [".ts", "text/typescript"],
  [".tsx", "text/tsx"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".zsh", "text/x-shellscript"],
]);

export function toDirectoryEntry(input: {
  name: string;
  path: string;
  persistence: AgentFilePersistence;
}): AgentFileTreeListingEntry {
  return {
    kind: "directory",
    mimeType: null,
    name: input.name,
    path: input.path,
    persistence: input.persistence,
    preview: "binary",
    sizeBytes: 0,
  };
}

function getExtension(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const lowerName = name.toLowerCase();

  if (lowerName === "dockerfile") {
    return ".dockerfile";
  }

  if (lowerName.startsWith(".") && TEXT_EXTENSIONS.has(lowerName)) {
    return lowerName;
  }

  const dotIndex = lowerName.lastIndexOf(".");
  return dotIndex < 0 ? "" : lowerName.slice(dotIndex);
}

export function inferMimeType(path: string, kind: AgentFileEntryKind): string | null {
  if (kind === "directory" || kind === "space_mount") {
    return null;
  }

  return MIME_BY_EXTENSION.get(getExtension(path)) ?? "application/octet-stream";
}

function isTextLikePath(path: string, mimeType: string): boolean {
  return TEXT_EXTENSIONS.has(getExtension(path)) || mimeType.startsWith("text/");
}

export function classifyAgentFilePreview(input: {
  mimeType: string;
  path: string;
  sizeBytes: number;
}): AgentFilePreview {
  if (input.sizeBytes === 0) {
    return "empty";
  }

  if (!isTextLikePath(input.path, input.mimeType)) {
    return "binary";
  }

  return input.sizeBytes < MAX_TEXT_PREVIEW_BYTES ? "text" : "large_text";
}

function getPersistence(path: string): AgentFilePersistence {
  if (path === SANDBOX_MEMORY_PATH || path.startsWith(`${SANDBOX_MEMORY_PATH}/`)) {
    return "persistent";
  }

  if (
    path === SANDBOX_GLOBAL_SPACE_ROOT ||
    path.startsWith(`${SANDBOX_GLOBAL_SPACE_ROOT}/`) ||
    path === SANDBOX_ORGANIZATION_ROOT
  ) {
    return "persistent";
  }

  return "temporary";
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0));
}

function parseNonNegativeInteger(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return parsed;
}

export function parseAgentFileListingOutput(
  parentPath: string,
  output: string,
): ListingParseResult {
  const entries: AgentFileTreeListingEntry[] = [];
  let totalCount: number | null = null;

  for (const line of output.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const [rawKind, rawSize, rawName] = line.split("\t");

    if (rawKind === LISTING_TOTAL_MARKER) {
      if (rawSize === undefined) {
        throw new Error("Missing total count in sandbox file listing.");
      }

      totalCount = parseNonNegativeInteger(rawSize, "sandbox listing total count");
      continue;
    }

    if (rawKind !== "directory" && rawKind !== "file" && rawKind !== "symlink") {
      throw new Error(`Unsupported sandbox file entry kind: ${rawKind ?? "(missing)"}`);
    }

    if (rawSize === undefined || rawName === undefined) {
      throw new Error("Malformed sandbox file listing entry.");
    }

    const name = decodeBase64(rawName);
    const path = parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;

    if (isSandboxCachePath(path) || isSandboxSessionStatePath(path)) {
      continue;
    }

    const sizeBytes = parseNonNegativeInteger(rawSize, "sandbox file size");
    const mimeType = inferMimeType(path, rawKind);

    entries.push({
      kind: rawKind,
      mimeType,
      name,
      path,
      persistence: getPersistence(path),
      preview:
        rawKind === "symlink" || mimeType === null
          ? "binary"
          : classifyAgentFilePreview({ mimeType, path, sizeBytes }),
      sizeBytes,
    });
  }

  const effectiveTotalCount = totalCount ?? entries.length;

  return {
    entries,
    totalCount: effectiveTotalCount,
    truncated: effectiveTotalCount > entries.length,
  };
}
