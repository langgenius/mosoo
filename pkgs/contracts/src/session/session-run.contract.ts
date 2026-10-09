import type { AgentDeploymentVersionId, SessionRunId } from "@mosoo/id";
import { type } from "arktype";

import { NonEmptyString, PrimitiveRecord } from "../validation/primitives.contract";

export const RunError = type({
  code: NonEmptyString,
  details: PrimitiveRecord,
  message: NonEmptyString,
  retryable: "boolean",
});
export type RunError = typeof RunError.infer;

export const SESSION_RUN_TRIGGERS = ["user_prompt", "retry", "resume", "system"] as const;
export type SessionRunTrigger = (typeof SESSION_RUN_TRIGGERS)[number];

export const SESSION_RUN_STATUSES = [
  "queued",
  "booting",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;
export type SessionRunStatus = (typeof SESSION_RUN_STATUSES)[number];

export interface SessionRunSummary {
  completedAt: string | null;
  createdAt: string;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  error: RunError | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  startedAt: string | null;
  status: SessionRunStatus;
  traceId: string;
  trigger: SessionRunTrigger;
  updatedAt: string;
}

export interface UserWarning {
  code: string;
  message: string;
}
