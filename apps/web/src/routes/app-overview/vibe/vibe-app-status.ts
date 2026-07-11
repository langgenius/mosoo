import type { AppVibeApp } from "@mosoo/contracts/app";

/**
 * Pure projection of a vibe app's live state onto the console's badge and
 * action affordances. Keeping it data-in/data-out lets the status matrix be
 * tested without rendering.
 */
export interface VibeAppStatusView {
  badgeLabel: "Building" | "Ready";
  badgeTone: "progress" | "success";
  canPublish: boolean;
  previewState: "live" | "pending";
  productionState: "live" | "unpublished";
}

export function toVibeAppStatusView(
  vibeApp: Pick<AppVibeApp, "previewUrl" | "productionUrl" | "status">,
): VibeAppStatusView {
  const ready = vibeApp.status === "ready";

  return {
    badgeLabel: ready ? "Ready" : "Building",
    badgeTone: ready ? "success" : "progress",
    canPublish: ready,
    previewState: vibeApp.previewUrl !== null ? "live" : "pending",
    productionState: vibeApp.productionUrl !== null ? "live" : "unpublished",
  };
}
