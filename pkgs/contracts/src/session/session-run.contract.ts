import { type } from "arktype";

import type {
  AccountId,
  AgentDeploymentVersionId,
  OrganizationId,
  SessionRunId,
  SpaceId,
} from "../id/id.contract";
import { NonEmptyString, PrimitiveRecord } from "../validation/primitives.contract";

export const RunError = type({
  code: NonEmptyString,
  details: PrimitiveRecord,
  message: NonEmptyString,
  retryable: "boolean",
});
export type RunError = typeof RunError.infer;

export const SESSION_RUN_TRIGGERS = ["user_prompt", "retry", "resume", "system"] as const;
export const SessionRunTrigger = type.enumerated(...SESSION_RUN_TRIGGERS);
export type SessionRunTrigger = typeof SessionRunTrigger.infer;

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
export const SessionRunStatus = type.enumerated(...SESSION_RUN_STATUSES);
export type SessionRunStatus = typeof SessionRunStatus.infer;

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

export interface OrganizationContext {
  activeSpaceId?: SpaceId | null;
  actorAccountId: AccountId;
  organizationId: OrganizationId;
}
