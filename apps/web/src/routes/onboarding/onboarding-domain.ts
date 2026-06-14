export function getOnboardingDomainOrganizationName(domain: string | undefined): string {
  const label = domain?.split(".")[0] ?? "";
  const normalized = label.trim();

  if (!normalized) {
    return "New App";
  }

  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}
