export const RUNTIME_SESSION_OUTPUT_DIR_NAME = "outputs";
export const RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES = 100;

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

function normalizeSandboxPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

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

  const normalizedPath = value.trim().replaceAll("\\", "/");

  if (
    normalizedPath.length === 0 ||
    normalizedPath.includes("\0") ||
    normalizedPath.startsWith("/")
  ) {
    return null;
  }

  const segments: string[] = [];

  for (const segment of normalizedPath.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      return null;
    }

    segments.push(segment);
  }

  return segments.length === 0 ? null : segments.join("/");
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
  const normalizedPath = normalizeSandboxPath(input.path);
  let relativePath: string | null;

  if (normalizedPath.startsWith("/")) {
    const normalizedOutputDir = normalizeSandboxPath(outputDir);

    if (!normalizedPath.startsWith(`${normalizedOutputDir}/`)) {
      return null;
    }

    relativePath = normalizeRuntimeSessionOutputRelativePath(
      normalizedPath.slice(normalizedOutputDir.length + 1),
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

export function readRuntimeSessionOutputListing(stdout: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const line of stdout.split("\n")) {
    const normalizedPath = normalizeRuntimeSessionOutputRelativePath(line);

    if (normalizedPath === null || seen.has(normalizedPath)) {
      continue;
    }

    seen.add(normalizedPath);
    paths.push(normalizedPath);

    if (paths.length >= RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES) {
      break;
    }
  }

  return paths;
}
