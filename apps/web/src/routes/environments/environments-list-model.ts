import type { EnvironmentSummary } from "@mosoo/contracts/environment";

export function selectPersonalEnvironments(
  environments: EnvironmentSummary[],
): EnvironmentSummary[] {
  return environments.filter((environment) => environment.role === "owner");
}

export function filterEnvironments(
  environments: EnvironmentSummary[],
  search: string,
): EnvironmentSummary[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return environments;
  }

  return environments.filter(
    (environment) =>
      environment.name.toLowerCase().includes(query) ||
      (environment.description ?? "").toLowerCase().includes(query),
  );
}
