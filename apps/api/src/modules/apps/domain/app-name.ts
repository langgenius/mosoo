export function normalizeAppName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("App name is required.");
  }

  return normalized;
}
