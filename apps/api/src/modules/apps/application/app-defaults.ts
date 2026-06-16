export const DEFAULT_APP_NAME = "Default App";
export const DEFAULT_APP_SLUG = "default";

export function normalizeAppName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("App name is required.");
  }

  return normalized;
}

export function deriveAppSlugBase(name: string): string {
  const slug = normalizeAppName(name)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  return slug || "app";
}
