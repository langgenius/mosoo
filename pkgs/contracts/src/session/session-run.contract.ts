import { type } from "arktype";

import type { AgentDeploymentVersionId, SessionRunId } from "../id/id.contract";
import { NonEmptyString, PrimitiveRecord } from "../validation/primitives.contract";

declare const TextEncoder: new () => { encode(input?: string): Uint8Array };

export const RunError = type({
  code: NonEmptyString,
  details: PrimitiveRecord,
  message: NonEmptyString,
  retryable: "boolean",
});
export type RunError = typeof RunError.infer;

export const DURABLE_RUN_ERROR_MAX_UTF8_BYTES = 1_020 * 1_024;

const durableRunErrorEncoder = new TextEncoder();

export function measureDurableRunErrorJson(error: unknown): number {
  return durableRunErrorEncoder.encode(JSON.stringify(error)).byteLength;
}

/** Maximum error payload that can be persisted on a D1-backed terminal row. */
export const DurableRunError = RunError.onUndeclaredKey("reject").narrow((error, context) => {
  const byteLength = measureDurableRunErrorJson(error);

  return byteLength <= DURABLE_RUN_ERROR_MAX_UTF8_BYTES
    ? true
    : context.reject({
        actual: `${byteLength} UTF-8 bytes`,
        expected: `at most ${DURABLE_RUN_ERROR_MAX_UTF8_BYTES} UTF-8 bytes`,
      });
});
export type DurableRunError = typeof DurableRunError.infer;

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
  error: DurableRunError | null;
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
