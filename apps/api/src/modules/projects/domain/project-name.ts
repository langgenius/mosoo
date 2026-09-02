export function normalizeProjectName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Project name is required.");
  }

  return normalized;
}
