export function normalizeAccountName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Name is required.");
  }

  return normalized;
}
