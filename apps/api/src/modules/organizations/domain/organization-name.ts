export function normalizeOrganizationName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Organization name is required.");
  }

  return normalized;
}

export function deriveOrganizationSlugBase(name: string): string {
  const slug = normalizeOrganizationName(name)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  return slug || "organization";
}
