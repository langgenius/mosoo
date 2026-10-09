import type {
  RunError,
  SessionRunStatus,
  SessionRunSummary,
  SessionRunTrigger,
} from "@mosoo/contracts/session-run";
import type { AgentDeploymentVersionId, SessionId, SessionRunId } from "@mosoo/id";

import { toIsoString } from "../../../../time";

export interface SessionRunRow {
  completed_at: number | null;
  created_at: number;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  error_code: string | null;
  error_details_json: string | null;
  error_message: string | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  session_id: SessionId;
  started_at: number | null;
  status: SessionRunStatus;
  trace_id: string;
  trigger: SessionRunTrigger;
  updated_at: number;
}

export function toSessionRunSummary(row: SessionRunRow): SessionRunSummary {
  return {
    completedAt: row.completed_at === null ? null : toIsoString(row.completed_at),
    createdAt: toIsoString(row.created_at),
    deploymentVersionId: row.deployment_version_id,
    deploymentVersionNumber: row.deployment_version_number,
    error: toRunError(row),
    id: row.id,
    model: row.model,
    provider: row.provider,
    startedAt: row.started_at === null ? null : toIsoString(row.started_at),
    status: row.status,
    traceId: row.trace_id,
    trigger: row.trigger,
    updatedAt: toIsoString(row.updated_at),
  };
}

function toRunError(row: SessionRunRow): RunError | null {
  if (
    row.error_code === null ||
    row.error_code === "" ||
    row.error_message === null ||
    row.error_message === ""
  ) {
    return null;
  }

  return {
    code: row.error_code,
    details: row.error_details_json === null ? {} : JSON.parse(row.error_details_json),
    message: row.error_message,
    retryable: false,
  };
}
