export const RUNTIME_ARTIFACT_MANIFEST_PATH = ".mosoo/artifacts.json";
export const RUNTIME_ARTIFACT_MANIFEST_MAX_FILES = 20;
export const RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES = 256 * 1024;

export interface RuntimeArtifactManifestEntry {
  readonly contentType: string | null;
  readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRuntimeArtifactPath(value: unknown): string | null {
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

export function getRuntimeArtifactFileName(path: string): string {
  const normalizedPath = normalizeRuntimeArtifactPath(path);

  if (normalizedPath === null) {
    throw new Error("Runtime artifact path must be a relative file path.");
  }

  const name = normalizedPath.split("/").at(-1);

  if (name === undefined) {
    throw new Error("Runtime artifact path must include a file name.");
  }

  return name;
}

export function isRuntimeArtifactManifestPath(path: string): boolean {
  const normalizedPath = path.trim().replaceAll("\\", "/");

  return (
    normalizedPath === RUNTIME_ARTIFACT_MANIFEST_PATH ||
    normalizedPath === `./${RUNTIME_ARTIFACT_MANIFEST_PATH}` ||
    normalizedPath.endsWith(`/${RUNTIME_ARTIFACT_MANIFEST_PATH}`)
  );
}

function readContentType(record: Record<string, unknown>): string | null {
  const contentType = record["contentType"] ?? record["mimeType"];

  if (typeof contentType !== "string") {
    return null;
  }

  const normalizedContentType = contentType.trim();
  return normalizedContentType.length === 0 ? null : normalizedContentType;
}

function readArtifactRecords(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value["artifacts"])) {
    return value["artifacts"];
  }

  return [];
}

export function readRuntimeArtifactManifestEntries(
  bytes: Uint8Array,
): RuntimeArtifactManifestEntry[] {
  if (bytes.byteLength > RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES) {
    throw new Error("Runtime artifact manifest is too large.");
  }

  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;

  return readArtifactRecords(parsed)
    .slice(0, RUNTIME_ARTIFACT_MANIFEST_MAX_FILES)
    .flatMap((entry): RuntimeArtifactManifestEntry[] => {
      if (!isRecord(entry)) {
        return [];
      }

      const path = normalizeRuntimeArtifactPath(entry["path"]);

      if (path === null || isRuntimeArtifactManifestPath(path)) {
        return [];
      }

      return [
        {
          contentType: readContentType(entry),
          path,
        },
      ];
    });
}
