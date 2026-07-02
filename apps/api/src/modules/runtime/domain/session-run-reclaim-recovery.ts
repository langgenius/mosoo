import type { RunError, SessionRunStatus, SessionRunTrigger } from "@mosoo/contracts/session-run";

import { isTerminalSessionRunStatus } from "./session-run-status";

/**
 * Involuntary-reclaim recovery decision logic.
 *
 * When the driver socket dies mid-run (sandbox reclaimed/evicted) the run is
 * failed, but today nothing recovers it and the two failure paths disagree on
 * whether the failure is retryable:
 *   - the synchronous path (terminal-run-release) reports retryable: true
 *   - the maintenance sweep (stale-run-reconciliation) reports retryable: false
 * for the SAME physical event. This module is the single source of truth for
 * both, so an eviction is classified identically everywhere, and it exposes the
 * pure decision — requeue vs fail-clean — that the recovery wiring consumes.
 *
 * Design references (see docs/perf-permission-work/00-findings.md): OMA's
 * `recoverInterruptedState`, agentos/opencomputer's "reclaim = lazy resume,
 * fail cleanly, never loop", OpenHands's durable-pause-then-resume.
 */

/** Terminal status of the driver instance behind the reclaimed run. */
export type DriverTerminalStatus = "failed" | "stopped";

/**
 * How the reclaim was observed:
 *   - `socket_closed`   the driver WebSocket closed (synchronous finalize)
 *   - `heartbeat_stale` the maintenance sweep found the run past its socket
 *                       timeout with no live driver
 */
export type ReclaimReason = "socket_closed" | "heartbeat_stale";

export interface ClassifyReclaimInput {
  readonly reclaimReason: ReclaimReason;
  /** Driver terminal status, or null when the driver never became terminal (inactive). */
  readonly driverTerminalStatus: DriverTerminalStatus | null;
  readonly driverInstanceId?: string;
  /** Driver-reported error message, if any (used by the sweep path). */
  readonly driverErrorMessage?: string | null;
}

/**
 * The single reclaim classifier. An involuntary reclaim is ALWAYS retryable
 * (a fresh run is safe) — `retryable` describes "is a retry safe?", decoupled
 * from "did we auto-requeue?" (that is `decideReclaimRecovery`'s job). Distinct
 * error codes are preserved because they carry real context, but the flag no
 * longer contradicts across paths.
 */
export function classifyReclaim(input: ClassifyReclaimInput): RunError {
  const details = input.driverInstanceId ? { driverInstanceId: input.driverInstanceId } : {};

  if (input.reclaimReason === "socket_closed") {
    if (input.driverTerminalStatus === "stopped") {
      return {
        code: "runtime.turn_interrupted",
        details,
        message:
          "This turn was interrupted. Your workspace and context have been preserved — please resend your last request.",
        retryable: true,
      };
    }

    return {
      code: "runtime.driver_failed",
      details,
      message: "Runtime driver failed before the run completed.",
      retryable: true,
    };
  }

  const driverFailed =
    input.driverTerminalStatus === "failed" || input.driverTerminalStatus === "stopped";
  const message =
    input.driverErrorMessage ??
    (driverFailed
      ? "Runtime driver stopped before the run completed."
      : "Runtime session became inactive before the run completed.");

  return {
    code: driverFailed ? "runtime.driver_stopped" : "runtime.inactive",
    details,
    message,
    retryable: true,
  };
}

/**
 * How many times a reclaimed run may be auto-resumed before we stop and leave
 * it to the user. Bounded to one so a run that is reclaimed, auto-resumed, then
 * reclaimed again fails cleanly instead of looping.
 */
export const DEFAULT_MAX_RECLAIM_ATTEMPTS = 1;

export interface ReclaimSignal {
  /** Status of the run at reclaim time. */
  readonly runStatus: SessionRunStatus;
  readonly driverTerminalStatus: DriverTerminalStatus;
  readonly reclaimReason: ReclaimReason;
  /**
   * Trigger of the reclaimed run — used as the attempt-budget proxy so no
   * schema change is required: a run already triggered by `resume` has spent
   * its one auto-resume.
   */
  readonly priorTrigger: SessionRunTrigger;
  readonly maxReclaimAttempts?: number;
}

export type ReclaimRecoveryAction =
  /** Run already terminal — nothing to recover. */
  | { readonly kind: "noop" }
  /** Auto-resume: create a fresh run and re-dispatch. */
  | { readonly kind: "requeue"; readonly resumeTrigger: "resume"; readonly runError: RunError }
  /** Attempt budget exhausted — fail cleanly (still retryable so the user may resend). */
  | { readonly kind: "fail_clean"; readonly runError: RunError };

/**
 * Number of auto-resume attempts already spent on this run, inferred from its
 * trigger. A `resume`-triggered run is itself the product of one auto-resume.
 */
function reclaimAttemptsSpent(priorTrigger: SessionRunTrigger): number {
  return priorTrigger === "resume" ? 1 : 0;
}

/**
 * Pure recovery decision. Terminal runs are a no-op; an active run within the
 * attempt budget is requeued; an active run that has exhausted the budget fails
 * cleanly (never loops).
 */
export function decideReclaimRecovery(signal: ReclaimSignal): ReclaimRecoveryAction {
  const runError = classifyReclaim({
    driverTerminalStatus: signal.driverTerminalStatus,
    reclaimReason: signal.reclaimReason,
  });

  if (isTerminalSessionRunStatus(signal.runStatus)) {
    return { kind: "noop" };
  }

  const maxAttempts = signal.maxReclaimAttempts ?? DEFAULT_MAX_RECLAIM_ATTEMPTS;

  if (reclaimAttemptsSpent(signal.priorTrigger) < maxAttempts) {
    return { kind: "requeue", resumeTrigger: "resume", runError };
  }

  return { kind: "fail_clean", runError };
}
