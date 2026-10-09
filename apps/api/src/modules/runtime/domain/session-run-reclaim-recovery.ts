import type { RunError } from "@mosoo/contracts/session-run";

/**
 * Involuntary-reclaim classification.
 *
 * When the driver socket dies mid-run (sandbox reclaimed/evicted) the run is
 * failed. The synchronous path (terminal-run-release) and the maintenance sweep
 * (stale-run-reconciliation) both classify that physical event here, so an
 * eviction gets the same error everywhere. Nothing retries it automatically;
 * see `docs/prd/session-lifecycle.md` for the user-visible recovery boundary.
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
 * (a fresh run is safe). Distinct error codes are preserved because they carry
 * real context, but the flag no longer contradicts across paths.
 */
export function classifyReclaim(input: ClassifyReclaimInput): RunError {
  const details = input.driverInstanceId ? { driverInstanceId: input.driverInstanceId } : {};

  if (input.reclaimReason === "socket_closed") {
    if (input.driverTerminalStatus === "stopped") {
      return {
        code: "runtime.turn_interrupted",
        details,
        message: "This turn was interrupted before it completed. Please resend your last request.",
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
