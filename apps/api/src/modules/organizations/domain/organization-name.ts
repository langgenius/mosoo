export function normalizeOrganizationName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Organization name is required.");
  }

  return normalized;
}
