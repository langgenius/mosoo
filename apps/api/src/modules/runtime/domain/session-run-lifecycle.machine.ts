import type { SessionRunStatus } from "@mosoo/contracts/session-run";

export const TERMINAL_SESSION_RUN_STATUSES = [
  "cancelled",
  "completed",
  "expired",
  "failed",
] as const satisfies readonly SessionRunStatus[];

export const ACTIVE_SESSION_RUN_STATUSES = [
  "queued",
  "booting",
  "running",
  "waiting_input",
] as const satisfies readonly SessionRunStatus[];

type TerminalSessionRunStatus = (typeof TERMINAL_SESSION_RUN_STATUSES)[number];
type ActiveSessionRunStatus = (typeof ACTIVE_SESSION_RUN_STATUSES)[number];

const NEXT_SESSION_RUN_STATUSES: Record<ActiveSessionRunStatus, readonly SessionRunStatus[]> = {
  booting: ["cancelled", "completed", "expired", "failed", "running", "waiting_input"],
  queued: ["booting", "cancelled", "expired", "failed", "running"],
  running: ["cancelled", "completed", "expired", "failed", "waiting_input"],
  waiting_input: ["cancelled", "completed", "expired", "failed", "running"],
};

const SESSION_RUN_STATUS_EVENT_NAMES = {
  booting: "run.boot",
  cancelled: "run.cancel",
  completed: "run.complete",
  expired: "run.expire",
  failed: "run.fail",
  queued: "run.queue",
  running: "run.start",
  waiting_input: "run.wait_for_input",
} as const satisfies Record<SessionRunStatus, string>;

export type SessionRunTransitionDecision =
  | { kind: "accepted" }
  | { currentStatus: SessionRunStatus; kind: "duplicate" }
  | {
      currentStatus: SessionRunStatus;
      kind: "rejected";
      reason: "illegal_transition";
      targetStatus: SessionRunStatus;
    }
  | {
      currentStatus: TerminalSessionRunStatus;
      kind: "stale";
      reason: "terminal_run";
      targetStatus: SessionRunStatus;
    };

export function isTerminalSessionRunStatus(
  status: SessionRunStatus | null,
): status is TerminalSessionRunStatus {
  return (
    status !== null && TERMINAL_SESSION_RUN_STATUSES.includes(status as TerminalSessionRunStatus)
  );
}

export function toSessionRunStatusLifecycleEventName(status: SessionRunStatus): string {
  return SESSION_RUN_STATUS_EVENT_NAMES[status];
}

export function decideSessionRunTransition({
  currentStatus,
  targetStatus,
}: {
  currentStatus: SessionRunStatus;
  targetStatus: SessionRunStatus;
}): SessionRunTransitionDecision {
  if (currentStatus === targetStatus) {
    return { currentStatus, kind: "duplicate" };
  }

  if (isTerminalSessionRunStatus(currentStatus)) {
    return { currentStatus, kind: "stale", reason: "terminal_run", targetStatus };
  }

  if (!NEXT_SESSION_RUN_STATUSES[currentStatus].includes(targetStatus)) {
    return { currentStatus, kind: "rejected", reason: "illegal_transition", targetStatus };
  }

  return { kind: "accepted" };
}
