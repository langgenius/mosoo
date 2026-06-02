import type { RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";

export type RuntimeCommandTransitionOutcome =
  | {
      kind: "applied";
      status: RuntimeCommandStatus;
    }
  | {
      kind: "duplicate";
      status: RuntimeCommandStatus;
    }
  | {
      currentStatus: RuntimeCommandStatus | null;
      kind: "rejected";
      reason:
        | "command_not_found"
        | "illegal_transition"
        | "inactive_delivery_connection"
        | "stale_delivery_connection";
      targetStatus: RuntimeCommandStatus;
    };

export interface RuntimeCommandBatchTransitionOutcome {
  appliedCount: number;
  kind: "batch_applied";
  status: RuntimeCommandStatus;
}

const previousStatusesByTarget = {
  accepted: ["delivered"],
  cancelled: ["queued", "delivered", "accepted"],
  completed: ["delivered", "accepted"],
  delivered: ["queued"],
  expired: ["queued", "delivered", "accepted"],
  failed: ["delivered", "accepted"],
  queued: ["delivered"],
} as const satisfies Record<RuntimeCommandStatus, readonly RuntimeCommandStatus[]>;

const deliveryLeaseExpirableStatuses = [
  "queued",
  "delivered",
] as const satisfies readonly RuntimeCommandStatus[];

export function getRuntimeCommandPreviousStatuses(
  status: RuntimeCommandStatus,
): readonly RuntimeCommandStatus[] {
  return previousStatusesByTarget[status];
}

export function getRuntimeCommandDeliveryLeaseExpirableStatuses(): readonly RuntimeCommandStatus[] {
  return deliveryLeaseExpirableStatuses;
}

export function createRuntimeCommandBatchTransitionOutcome(
  status: RuntimeCommandStatus,
  appliedCount: number,
): RuntimeCommandBatchTransitionOutcome {
  return {
    appliedCount,
    kind: "batch_applied",
    status,
  };
}

export function isRuntimeCommandAcknowledgedStatus(status: RuntimeCommandStatus): boolean {
  return status === "accepted" || status === "completed" || status === "failed";
}

export function isRuntimeCommandTerminalStatus(status: RuntimeCommandStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired"
  );
}

export function decideRuntimeCommandTransition(
  currentStatus: RuntimeCommandStatus,
  targetStatus: RuntimeCommandStatus,
): RuntimeCommandTransitionOutcome {
  if (currentStatus === targetStatus) {
    return {
      kind: "duplicate",
      status: currentStatus,
    };
  }

  if (getRuntimeCommandPreviousStatuses(targetStatus).includes(currentStatus)) {
    return {
      kind: "applied",
      status: targetStatus,
    };
  }

  return {
    currentStatus,
    kind: "rejected",
    reason: "illegal_transition",
    targetStatus,
  };
}
