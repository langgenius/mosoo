export function normalizeR2Etag(etag: string | null | undefined): string | null {
  const normalized =
    etag
      ?.trim()
      .replace(/^W\/\s*/i, "")
      .trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.startsWith('"') && normalized.endsWith('"') && normalized.length >= 2) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

export function formatR2EtagHeader(etag: string): string {
  const trimmed = etag.trim();

  if (trimmed === "*") {
    return trimmed;
  }

  const normalized = normalizeR2Etag(trimmed);

  return normalized === null ? trimmed : `"${normalized}"`;
}
