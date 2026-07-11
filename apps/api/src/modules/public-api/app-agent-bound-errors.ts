/**
 * Failure model for the bound-agent ask endpoint (`POST /api/v1/bound/:token`).
 *
 * The bound endpoint authorizes via a self-authorizing capability URL (no PAT),
 * so it does not flow through the PAT `runPublicApi*` route helpers. It renders
 * its own error responses here. Cases that already have a public-API meaning
 * (invalid capability -> 401, Agent un-published -> 409, bad request -> 400) are
 * raised with the existing `PublicApiError` helpers and rendered via
 * `toPublicApiError`. Failures unique to a one-call blocking ask — the
 * run never reaching a terminal state in time, and a terminal-but-not-completed
 * run, and a completed run whose canonical reply is missing — get the
 * dedicated codes below.
 */

import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import { publicReadinessBlocked, toPublicApiError } from "./public-api-errors";

/** Returned when the bound Agent run does not reach a terminal state in time. */
export const DEPLOYMENT_AGENT_CALL_TIMEOUT_ERROR_CODE = "deployment_agent_call_timeout";
/** Returned when the bound Agent run finished without a successful reply. */
export const DEPLOYMENT_AGENT_RUN_FAILED_ERROR_CODE = "deployment_agent_run_failed";
/** Returned when the bound Agent pauses for interactive input the single-call ask cannot provide. */
export const DEPLOYMENT_AGENT_NEEDS_INPUT_ERROR_CODE = "deployment_agent_needs_input";
/** Returned when a completed bound Agent run has no canonical final assistant message. */
export const DEPLOYMENT_AGENT_FINAL_OUTPUT_MISSING_ERROR_CODE =
  "deployment_agent_final_output_missing";

export type BoundAgentCallErrorCode =
  | typeof DEPLOYMENT_AGENT_CALL_TIMEOUT_ERROR_CODE
  | typeof DEPLOYMENT_AGENT_FINAL_OUTPUT_MISSING_ERROR_CODE
  | typeof DEPLOYMENT_AGENT_RUN_FAILED_ERROR_CODE
  | typeof DEPLOYMENT_AGENT_NEEDS_INPUT_ERROR_CODE;

export class BoundAgentCallError extends Error {
  readonly code: BoundAgentCallErrorCode;
  readonly status: number;

  constructor(input: { code: BoundAgentCallErrorCode; message: string; status: number }) {
    super(input.message);
    this.name = "BoundAgentCallError";
    this.code = input.code;
    this.status = input.status;
  }
}

export function boundAgentCallTimeout(): BoundAgentCallError {
  return new BoundAgentCallError({
    code: DEPLOYMENT_AGENT_CALL_TIMEOUT_ERROR_CODE,
    message: "The bound Agent did not return a final reply before the request timed out.",
    status: 504,
  });
}

export function boundAgentNeedsInput(): BoundAgentCallError {
  return new BoundAgentCallError({
    code: DEPLOYMENT_AGENT_NEEDS_INPUT_ERROR_CODE,
    message:
      "The bound Agent paused for interactive input, which a single-call bound ask cannot provide.",
    status: 422,
  });
}

export function boundAgentFinalOutputMissing(): BoundAgentCallError {
  return new BoundAgentCallError({
    code: DEPLOYMENT_AGENT_FINAL_OUTPUT_MISSING_ERROR_CODE,
    message: "The bound Agent run completed without a canonical final reply.",
    status: 503,
  });
}

export function boundAgentRunFailed(
  status: SessionRunStatus,
  error: RunError | null,
): BoundAgentCallError {
  return new BoundAgentCallError({
    code: DEPLOYMENT_AGENT_RUN_FAILED_ERROR_CODE,
    message: error?.message ?? `The bound Agent run ended without a reply (${status}).`,
    status: 502,
  });
}

interface BoundAgentCallErrorResponse {
  body: { error: { code: string; message: string } };
  status: number;
}

function errorResponse(code: string, message: string, status: number): BoundAgentCallErrorResponse {
  return { body: { error: { code, message } }, status };
}

export function renderBoundAgentCallError(error: unknown): BoundAgentCallErrorResponse {
  if (error instanceof BoundAgentCallError) {
    return errorResponse(error.code, error.message, error.status);
  }

  const publicError = toPublicApiError(error);
  if (publicError) {
    return errorResponse(publicError.code, publicError.message, publicError.status);
  }

  if (error instanceof Error && error.message.startsWith("Agent is not ready to run:")) {
    const readiness = publicReadinessBlocked(error.message);
    return errorResponse(readiness.code, readiness.message, readiness.status);
  }

  if (error instanceof SyntaxError) {
    return errorResponse("invalid_json", "Request body must be valid JSON.", 400);
  }

  logError("public-api.bound_agent_call.failed", createErrorLogContext(error));
  return errorResponse("internal_error", "Bound Agent call failed.", 500);
}
