import type { AppSummary } from "@mosoo/contracts/app";

export function resolveActiveApp(apps: readonly AppSummary[]): AppSummary | null {
  if (apps.length !== 1) {
    return null;
  }

  const [onlyApp] = apps;
  return onlyApp ?? null;
}
