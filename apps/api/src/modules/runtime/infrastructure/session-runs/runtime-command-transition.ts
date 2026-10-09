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
      reason: "command_not_found" | "illegal_transition";
      targetStatus: RuntimeCommandStatus;
    };

const previousStatusesByTarget: Record<RuntimeCommandStatus, readonly RuntimeCommandStatus[]> = {
  accepted: ["delivered"],
  cancelled: ["queued", "delivered", "accepted"],
  completed: ["delivered", "accepted"],
  delivered: ["queued"],
  expired: ["queued", "delivered", "accepted"],
  failed: ["delivered", "accepted"],
  queued: [],
};

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

  if (previousStatusesByTarget[targetStatus].includes(currentStatus)) {
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
