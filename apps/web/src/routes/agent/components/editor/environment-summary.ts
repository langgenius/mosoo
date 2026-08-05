import type { EnvironmentSummary } from "@mosoo/contracts/environment";

export function describeEnvironment(
  environment: EnvironmentSummary,
  t: (key: string, variables?: Record<string, string>) => string = (key) => key,
): string {
  const network =
    environment.networkPolicy === "full"
      ? t("agentEditor.fullNetwork")
      : t("agentEditor.limitedNetwork");
  const packages = environment.packages.reduce((count, entry) => count + entry.packages.length, 0);

  if (packages === 0) {
    return network;
  }

  return `${network} · ${t("agentEditor.packageCount", { count: String(packages) })}`;
}
