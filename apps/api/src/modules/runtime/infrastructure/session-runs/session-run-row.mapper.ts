import type {
  RunError,
  SessionRunStatus,
  SessionRunSummary,
  SessionRunTrigger,
} from "@mosoo/contracts/session-run";
import type { PrimitiveRecord } from "@mosoo/contracts/validation";
import {
  PrimitiveRecord as PrimitiveRecordSchema,
  parseSchemaValue,
} from "@mosoo/contracts/validation";
import type { AgentDeploymentVersionId, SessionId, SessionRunId } from "@mosoo/id";

import { toIsoString } from "../../../../time";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";

export type ActiveSessionRunStatus = Extract<
  SessionRunStatus,
  "queued" | "booting" | "running" | "waiting_input"
>;

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

export function buildActiveSessionRunStatusFilter(alias = "status"): string {
  return `${alias} IN (${ACTIVE_SESSION_RUN_STATUSES.map((status) => `'${status}'`).join(", ")})`;
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

function parseJsonRecord(raw: string | null): PrimitiveRecord {
  if (raw === null) {
    return {};
  }

  if (!raw.trim()) {
    throw new Error("Session run error details must not be empty.");
  }

  const parsed = parseRunErrorDetailsJson(raw);

  try {
    return parseSchemaValue(PrimitiveRecordSchema, parsed);
  } catch {
    throw new Error("Session run error details must be a primitive record.");
  }
}

function parseRunErrorDetailsJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Session run error details are not valid JSON.");
  }
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
    details: parseJsonRecord(row.error_details_json),
    message: row.error_message,
    retryable: false,
  };
}
