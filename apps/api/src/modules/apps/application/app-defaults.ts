export const DEFAULT_APP_NAME = "Default App";

export function normalizeAppName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("App name is required.");
  }

  return normalized;
}
