import type { AppVibeApp } from "@mosoo/contracts/app";

/**
 * Pure projection of a vibe app's live state onto the console's affordances.
 * Keeping it data-in/data-out lets the status matrix be tested without
 * rendering.
 */
export interface VibeAppStatusView {
  /** Production URL is live. */
  live: boolean;
  /** Generation finished; publish and iteration are unlocked. */
  ready: boolean;
}

export function toVibeAppStatusView(
  vibeApp: Pick<AppVibeApp, "productionUrl" | "status">,
): VibeAppStatusView {
  return {
    live: vibeApp.productionUrl !== null,
    ready: vibeApp.status === "ready",
  };
}
