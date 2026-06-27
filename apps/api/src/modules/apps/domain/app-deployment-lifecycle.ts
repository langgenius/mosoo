import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";

export const ACTIVE_APP_DEPLOYMENT_RUN_STATUSES = [
  "queued",
  "preparing",
  "building",
  "submitting",
  "submitted",
  "activating",
] as const satisfies readonly AppDeploymentRunStatus[];
