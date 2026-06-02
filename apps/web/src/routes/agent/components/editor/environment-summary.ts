import type { EnvironmentSummary } from "@mosoo/contracts/environment";

export function describeEnvironment(environment: EnvironmentSummary): string {
  const network = environment.networkPolicy === "full" ? "Full network" : "Limited network";
  const packages = environment.packages.reduce((count, entry) => count + entry.packages.length, 0);

  if (packages === 0) {
    return network;
  }

  return `${network} · ${packages} packages`;
}
