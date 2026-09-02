import { normalizeLibraryFilePath } from "@mosoo/contracts/file";

export const RUNTIME_SESSION_OUTPUT_DIR_NAME = "outputs";
export const RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES = 100;
export const RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface RuntimeSessionOutputInventoryFile {
  readonly relativePath: string;
  readonly size: number;
}

export interface RuntimeSessionOutputFile {
  readonly artifactPath: string;
  readonly contentType: string | null;
  readonly readPath: string;
  readonly relativePath: string;
}

const contentTypesByExtension = new Map<string, string>([
  ["csv", "text/csv"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["gif", "image/gif"],
  ["htm", "text/html"],
  ["html", "text/html"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["json", "application/json"],
  ["md", "text/markdown"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["txt", "text/plain"],
  ["webp", "image/webp"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["zip", "application/zip"],
]);

function joinSandboxPath(parent: string, child: string): string {
  return `${parent.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

export function getRuntimeSessionOutputDirectory(cwd: string): string {
  return joinSandboxPath(cwd, RUNTIME_SESSION_OUTPUT_DIR_NAME);
}

export function normalizeRuntimeSessionOutputRelativePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const normalizedPath = normalizeLibraryFilePath(value);
    return normalizedPath === value ? normalizedPath : null;
  } catch {
    return null;
  }
}

export function toRuntimeSessionOutputArtifactPath(relativePath: string): string {
  return `${RUNTIME_SESSION_OUTPUT_DIR_NAME}/${relativePath}`;
}

export function guessRuntimeSessionOutputContentType(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase();

  if (extension === undefined || extension === path.toLowerCase()) {
    return null;
  }

  return contentTypesByExtension.get(extension) ?? null;
}

export function toRuntimeSessionOutputFile(input: {
  readonly contentType?: string | null;
  readonly cwd: string;
  readonly path: string;
}): RuntimeSessionOutputFile | null {
  const outputDir = getRuntimeSessionOutputDirectory(input.cwd);
  const normalizedPath = input.path;
  let relativePath: string | null;

  if (normalizedPath.startsWith("/")) {
    if (!normalizedPath.startsWith(`${outputDir}/`)) {
      return null;
    }

    relativePath = normalizeRuntimeSessionOutputRelativePath(
      normalizedPath.slice(outputDir.length + 1),
    );
  } else {
    const normalizedRelativePath = normalizeRuntimeSessionOutputRelativePath(normalizedPath);

    if (normalizedRelativePath === null) {
      return null;
    }

    const outputPrefix = `${RUNTIME_SESSION_OUTPUT_DIR_NAME}/`;

    if (!normalizedRelativePath.startsWith(outputPrefix)) {
      return null;
    }

    relativePath = normalizeRuntimeSessionOutputRelativePath(
      normalizedRelativePath.slice(outputPrefix.length),
    );
  }

  if (relativePath === null) {
    return null;
  }

  const artifactPath = toRuntimeSessionOutputArtifactPath(relativePath);
  const contentType =
    input.contentType !== undefined && input.contentType !== null && input.contentType.trim() !== ""
      ? input.contentType.trim()
      : guessRuntimeSessionOutputContentType(relativePath);

  return {
    artifactPath,
    contentType,
    readPath: joinSandboxPath(outputDir, relativePath),
    relativePath,
  };
}

export function readRuntimeSessionOutputInventory(
  stdout: string,
): RuntimeSessionOutputInventoryFile[] {
  const files: RuntimeSessionOutputInventoryFile[] = [];
  const seen = new Set<string>();
  const fields = stdout.split("\0");

  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % 2 !== 0) {
    throw new Error("Runtime output inventory is invalid.");
  }

  for (let index = 0; index < fields.length; index += 2) {
    const inventoryPath = fields[index];
    const relativePath = inventoryPath?.startsWith("./")
      ? normalizeRuntimeSessionOutputRelativePath(inventoryPath.slice(2))
      : null;
    const sizeText = fields[index + 1];
    const size = Number(sizeText);

    if (
      relativePath === null ||
      seen.has(relativePath) ||
      !/^\d+$/.test(sizeText ?? "") ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw new Error("Runtime output inventory is invalid.");
    }

    seen.add(relativePath);
    files.push({ relativePath, size });
  }

  return files;
}
