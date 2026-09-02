import type { SandboxStatus } from "@mosoo/contracts/sandbox";

export const RUNTIME_SUBJECT_CLAIMABLE_STATUSES = [
  "active",
  "cold",
] as const satisfies readonly SandboxStatus[];

export const RUNTIME_SUBJECT_OPERATION_STATUSES = [
  "backing_up",
  "destroying",
] as const satisfies readonly SandboxStatus[];

export const RUNTIME_SUBJECT_RECOVERABLE_OPERATION_STATUSES = [
  "restoring",
  ...RUNTIME_SUBJECT_OPERATION_STATUSES,
] as const satisfies readonly SandboxStatus[];

export type RuntimeSubjectOperationStatus = (typeof RUNTIME_SUBJECT_OPERATION_STATUSES)[number];
export type RuntimeSubjectRecoverableOperationStatus =
  (typeof RUNTIME_SUBJECT_RECOVERABLE_OPERATION_STATUSES)[number];

// There is no dedicated failure state. A failed lifecycle step makes the
// container untrustworthy, so activation first enters `destroying`. Successful
// teardown returns it to `cold`; a failed/timeout teardown stays `destroying`
// with its operation id so maintenance can resume the same repair.
export type RuntimeSubjectLifecycleEvent =
  | { type: "runtime_subject.activate" }
  | { type: "runtime_subject.active" }
  | { type: "runtime_subject.back_up" }
  | { type: "runtime_subject.cold" }
  | { type: "runtime_subject.destroy" };

const RUNTIME_SUBJECT_EVENT_BY_STATUS = {
  active: { type: "runtime_subject.active" },
  backing_up: { type: "runtime_subject.back_up" },
  cold: { type: "runtime_subject.cold" },
  destroying: { type: "runtime_subject.destroy" },
  restoring: { type: "runtime_subject.activate" },
} as const satisfies Record<SandboxStatus, RuntimeSubjectLifecycleEvent>;

const RUNTIME_SUBJECT_TRANSITIONS: Record<SandboxStatus, readonly SandboxStatus[]> = {
  active: ["backing_up", "cold", "destroying"],
  backing_up: ["active", "cold", "destroying"],
  cold: ["restoring", "backing_up", "destroying"],
  destroying: ["cold"],
  restoring: ["active", "cold", "destroying"],
};

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

  if (!RUNTIME_SUBJECT_TRANSITIONS[input.currentStatus].includes(input.targetStatus)) {
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
