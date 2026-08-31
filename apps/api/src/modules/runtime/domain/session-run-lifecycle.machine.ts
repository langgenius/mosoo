import type { SessionRunStatus } from "@mosoo/contracts/session-run";

const TERMINAL_SESSION_RUN_STATUSES = [
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

export type SessionRunLifecycleEvent =
  | { type: "run.boot" }
  | { type: "run.cancel" }
  | { type: "run.complete" }
  | { type: "run.expire" }
  | { type: "run.fail" }
  | { type: "run.queue" }
  | { type: "run.start" }
  | { type: "run.wait_for_input" };

const SESSION_RUN_EVENT_BY_STATUS = {
  booting: { type: "run.boot" },
  cancelled: { type: "run.cancel" },
  completed: { type: "run.complete" },
  expired: { type: "run.expire" },
  failed: { type: "run.fail" },
  queued: { type: "run.queue" },
  running: { type: "run.start" },
  waiting_input: { type: "run.wait_for_input" },
} as const satisfies Record<SessionRunStatus, SessionRunLifecycleEvent>;

const previousStatusesByTarget: Readonly<Record<SessionRunStatus, readonly SessionRunStatus[]>> = {
  booting: ["queued"],
  cancelled: ["booting", "queued", "running", "waiting_input"],
  completed: ["booting", "running", "waiting_input"],
  expired: ["booting", "queued", "running", "waiting_input"],
  failed: ["booting", "queued", "running", "waiting_input"],
  queued: [],
  running: ["booting", "queued", "waiting_input"],
  waiting_input: ["booting", "running"],
};

export type SessionRunTransitionDecision =
  | {
      kind: "accepted";
      event: SessionRunLifecycleEvent;
      nextStatus: SessionRunStatus;
      previousStatus: SessionRunStatus;
    }
  | {
      kind: "duplicate";
      currentStatus: SessionRunStatus;
      event: SessionRunLifecycleEvent;
    }
  | {
      kind: "rejected";
      currentStatus: SessionRunStatus;
      event: SessionRunLifecycleEvent;
      reason: "illegal_transition";
      targetStatus: SessionRunStatus;
    }
  | {
      kind: "stale";
      currentStatus: TerminalSessionRunStatus;
      event: SessionRunLifecycleEvent;
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

function toSessionRunLifecycleEvent(status: SessionRunStatus): SessionRunLifecycleEvent {
  return SESSION_RUN_EVENT_BY_STATUS[status];
}

export function toSessionRunStatusLifecycleEventName(status: SessionRunStatus): string {
  return toSessionRunLifecycleEvent(status).type;
}

export function decideSessionRunTransition(input: {
  currentStatus: SessionRunStatus;
  targetStatus: SessionRunStatus;
}): SessionRunTransitionDecision {
  const event = toSessionRunLifecycleEvent(input.targetStatus);

  if (input.currentStatus === input.targetStatus) {
    return {
      currentStatus: input.currentStatus,
      event,
      kind: "duplicate",
    };
  }

  if (isTerminalSessionRunStatus(input.currentStatus)) {
    return {
      currentStatus: input.currentStatus,
      event,
      kind: "stale",
      reason: "terminal_run",
      targetStatus: input.targetStatus,
    };
  }

  if (!previousStatusesByTarget[input.targetStatus].includes(input.currentStatus)) {
    return {
      currentStatus: input.currentStatus,
      event,
      kind: "rejected",
      reason: "illegal_transition",
      targetStatus: input.targetStatus,
    };
  }

  return {
    event,
    kind: "accepted",
    nextStatus: input.targetStatus,
    previousStatus: input.currentStatus,
  };
}
