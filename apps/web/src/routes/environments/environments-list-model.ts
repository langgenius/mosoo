import type { EnvironmentSummary } from "@mosoo/contracts/environment";

import type { Scope } from "@/shared/ui/scope-tabs";

export interface EnvironmentScopeGroups {
  personalEnvironments: EnvironmentSummary[];
  sharedEnvironments: EnvironmentSummary[];
}

export function groupEnvironmentsByScope(
  environments: EnvironmentSummary[],
): EnvironmentScopeGroups {
  return {
    personalEnvironments: environments.filter((environment) => environment.role === "owner"),
    sharedEnvironments: environments.filter((environment) => environment.role === "user"),
  };
}

export function getEnvironmentsForScope(
  groups: EnvironmentScopeGroups,
  scope: Scope,
): EnvironmentSummary[] {
  return scope === "shared" ? groups.sharedEnvironments : groups.personalEnvironments;
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
