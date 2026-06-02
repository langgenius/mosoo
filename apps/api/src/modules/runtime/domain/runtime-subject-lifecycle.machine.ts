import type { SandboxStatus } from "@mosoo/contracts/sandbox";
import { createMachine, transition } from "xstate";

export const RUNTIME_SUBJECT_CLAIMABLE_STATUSES = [
  "active",
  "cold",
  "error",
] as const satisfies readonly SandboxStatus[];

export const RUNTIME_SUBJECT_OPERATION_STATUSES = [
  "backing_up",
  "destroying",
] as const satisfies readonly SandboxStatus[];

export type RuntimeSubjectOperationStatus = (typeof RUNTIME_SUBJECT_OPERATION_STATUSES)[number];

export type RuntimeSubjectLifecycleEvent =
  | { type: "runtime_subject.activate" }
  | { type: "runtime_subject.active" }
  | { type: "runtime_subject.back_up" }
  | { type: "runtime_subject.cold" }
  | { type: "runtime_subject.destroy" }
  | { type: "runtime_subject.fail" };

const RUNTIME_SUBJECT_STATUS_BY_EVENT = {
  "runtime_subject.activate": "restoring",
  "runtime_subject.active": "active",
  "runtime_subject.back_up": "backing_up",
  "runtime_subject.cold": "cold",
  "runtime_subject.destroy": "destroying",
  "runtime_subject.fail": "error",
} as const satisfies Record<RuntimeSubjectLifecycleEvent["type"], SandboxStatus>;

const RUNTIME_SUBJECT_EVENT_BY_STATUS = {
  active: { type: "runtime_subject.active" },
  backing_up: { type: "runtime_subject.back_up" },
  cold: { type: "runtime_subject.cold" },
  destroying: { type: "runtime_subject.destroy" },
  error: { type: "runtime_subject.fail" },
  restoring: { type: "runtime_subject.activate" },
} as const satisfies Record<SandboxStatus, RuntimeSubjectLifecycleEvent>;

const runtimeSubjectLifecycleMachine = createMachine({
  id: "runtimeSubjectLifecycle",
  initial: "cold",
  states: {
    active: {
      on: {
        "runtime_subject.active": "active",
        "runtime_subject.back_up": "backing_up",
        "runtime_subject.destroy": "destroying",
        "runtime_subject.fail": "error",
      },
    },
    backing_up: {
      on: {
        "runtime_subject.active": "active",
        "runtime_subject.cold": "cold",
        "runtime_subject.destroy": "destroying",
        "runtime_subject.fail": "error",
      },
    },
    cold: {
      on: {
        "runtime_subject.activate": "restoring",
        "runtime_subject.back_up": "backing_up",
        "runtime_subject.destroy": "destroying",
        "runtime_subject.fail": "error",
      },
    },
    destroying: {
      on: {
        "runtime_subject.cold": "cold",
        "runtime_subject.fail": "error",
      },
    },
    error: {
      on: {
        "runtime_subject.active": "active",
        "runtime_subject.back_up": "backing_up",
        "runtime_subject.destroy": "destroying",
      },
    },
    restoring: {
      on: {
        "runtime_subject.active": "active",
        "runtime_subject.fail": "error",
      },
    },
  },
  types: {} as {
    events: RuntimeSubjectLifecycleEvent;
  },
});

export type RuntimeSubjectTransitionDecision =
  | {
      event: RuntimeSubjectLifecycleEvent;
      kind: "accepted";
      nextStatus: SandboxStatus;
      previousStatus: SandboxStatus;
    }
  | {
      currentStatus: SandboxStatus;
      event: RuntimeSubjectLifecycleEvent;
      kind: "duplicate";
    }
  | {
      currentStatus: SandboxStatus;
      event: RuntimeSubjectLifecycleEvent;
      kind: "rejected";
      reason: "illegal_transition";
      targetStatus: SandboxStatus;
    };

function toRuntimeSubjectLifecycleEvent(status: SandboxStatus): RuntimeSubjectLifecycleEvent {
  return RUNTIME_SUBJECT_EVENT_BY_STATUS[status];
}

export function toRuntimeSubjectStatusLifecycleEventName(status: SandboxStatus): string {
  return toRuntimeSubjectLifecycleEvent(status).type;
}

export function decideRuntimeSubjectTransition(input: {
  currentStatus: SandboxStatus;
  targetStatus: SandboxStatus;
}): RuntimeSubjectTransitionDecision {
  const event = toRuntimeSubjectLifecycleEvent(input.targetStatus);

  if (input.currentStatus === input.targetStatus) {
    return {
      currentStatus: input.currentStatus,
      event,
      kind: "duplicate",
    };
  }

  const snapshot = runtimeSubjectLifecycleMachine.resolveState({ value: input.currentStatus });
  const [nextSnapshot] = transition(runtimeSubjectLifecycleMachine, snapshot, event);
  const nextStatus = readRuntimeSubjectSnapshotValue(nextSnapshot.value);

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

function readRuntimeSubjectSnapshotValue(value: unknown): SandboxStatus {
  if (typeof value !== "string" || !(value in RUNTIME_SUBJECT_EVENT_BY_STATUS)) {
    throw new Error("Runtime subject lifecycle machine returned an unknown state.");
  }

  return RUNTIME_SUBJECT_STATUS_BY_EVENT[
    toRuntimeSubjectLifecycleEvent(value as SandboxStatus).type
  ];
}
