import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";

export type DeploymentRunOutcome = "deploying" | "failed" | "successful";

export type ProductionEnvironmentStatus = "deploying" | "live" | "unavailable";

/** Collapse executor phases into the outcomes users can understand and act on. */
export function toDeploymentRunOutcome(status: AppDeploymentRunStatus): DeploymentRunOutcome {
  switch (status) {
    case "activating":
    case "building":
    case "preparing":
    case "queued":
    case "submitted":
    case "submitting":
      return "deploying";
    case "failed":
      return "failed";
    case "success":
      return "successful";
  }
}

/** Production availability is independent from the latest deployment attempt. */
export function toProductionEnvironmentStatus(
  liveUrl: string | null,
  latestOutcome: DeploymentRunOutcome | undefined,
): ProductionEnvironmentStatus {
  if (liveUrl !== null) {
    return "live";
  }

  return latestOutcome === "deploying" ? "deploying" : "unavailable";
}
