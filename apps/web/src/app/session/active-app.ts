import type { AppSummary } from "@mosoo/contracts/app";

// Resolves the active App for the App-layer console:
// - an explicit selection wins (multi-App switching),
// - otherwise a lone App lands the user straight in it (single-App / OPC),
// - otherwise null, which routes a multi-App owner to the Org-layer Apps list.
export function resolveActiveApp(
  apps: readonly AppSummary[],
  selectedAppId: string | null = null,
): AppSummary | null {
  if (selectedAppId !== null) {
    const selected = apps.find((app) => app.id === selectedAppId);

    if (selected !== undefined) {
      return selected;
    }
  }

  if (apps.length === 1) {
    const [onlyApp] = apps;
    return onlyApp ?? null;
  }

  return null;
}
