import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import { createMachine, transition } from "xstate";

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

const SESSION_RUN_STATUS_BY_EVENT = {
  "run.boot": "booting",
  "run.cancel": "cancelled",
  "run.complete": "completed",
  "run.expire": "expired",
  "run.fail": "failed",
  "run.queue": "queued",
  "run.start": "running",
  "run.wait_for_input": "waiting_input",
} as const satisfies Record<SessionRunLifecycleEvent["type"], SessionRunStatus>;

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

const sessionRunLifecycleMachine = createMachine({
  id: "sessionRunLifecycle",
  initial: "queued",
  states: {
    booting: {
      on: {
        "run.cancel": "cancelled",
        "run.complete": "completed",
        "run.expire": "expired",
        "run.fail": "failed",
        "run.start": "running",
        "run.wait_for_input": "waiting_input",
      },
    },
    cancelled: {},
    completed: {},
    expired: {},
    failed: {},
    queued: {
      on: {
        "run.boot": "booting",
        "run.cancel": "cancelled",
        "run.expire": "expired",
        "run.fail": "failed",
        "run.start": "running",
      },
    },
    running: {
      on: {
        "run.cancel": "cancelled",
        "run.complete": "completed",
        "run.expire": "expired",
        "run.fail": "failed",
        "run.wait_for_input": "waiting_input",
      },
    },
    waiting_input: {
      on: {
        "run.cancel": "cancelled",
        "run.complete": "completed",
        "run.expire": "expired",
        "run.fail": "failed",
        "run.start": "running",
      },
    },
  },
  types: {} as {
    events: SessionRunLifecycleEvent;
  },
});

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

  const snapshot = sessionRunLifecycleMachine.resolveState({ value: input.currentStatus });
  const [nextSnapshot] = transition(sessionRunLifecycleMachine, snapshot, event);
  const nextStatus = readSessionRunSnapshotValue(nextSnapshot.value);

  if (nextStatus === input.currentStatus) {
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
    nextStatus,
    previousStatus: input.currentStatus,
  };
}

function readSessionRunSnapshotValue(value: unknown): SessionRunStatus {
  if (typeof value !== "string" || !(value in SESSION_RUN_EVENT_BY_STATUS)) {
    throw new Error("Session run lifecycle machine returned an unknown state.");
  }

  return SESSION_RUN_STATUS_BY_EVENT[toSessionRunLifecycleEvent(value as SessionRunStatus).type];
}
