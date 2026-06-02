export type ChannelConnectionOwnerStatus =
  | "failed"
  | "idle"
  | "reconnecting"
  | "relogin_required"
  | "running"
  | "stale"
  | "starting"
  | "stopped";

export interface ChannelConnectionKey {
  accountId: string | null;
  bindingId: ChannelBindingId;
  provider: string;
}

export interface ChannelConnectionOwnerSnapshot {
  key: ChannelConnectionKey;
  lastErrorCode: string | null;
  lastHeartbeatAtMs: number | null;
  lastInboundAtMs: number | null;
  lastPollAtMs: number | null;
  leaseExpiresAtMs: number | null;
  leaseOwnerId: string | null;
  status: ChannelConnectionOwnerStatus;
  statusChangedAtMs: number;
}

export interface ChannelConnectionHealthSummary {
  reason: string | null;
  stale: boolean;
  status: ChannelConnectionOwnerStatus;
}

function isRuntimeTransitionStatus(status: ChannelConnectionOwnerStatus): boolean {
  return status === "starting" || status === "reconnecting";
}

export function summarizeChannelConnectionOwnerHealth(
  snapshot: ChannelConnectionOwnerSnapshot,
  input: {
    nowMs: number;
    staleAfterMs: number;
  },
): ChannelConnectionHealthSummary {
  if (snapshot.leaseExpiresAtMs !== null && snapshot.leaseExpiresAtMs <= input.nowMs) {
    return {
      reason: "lease_expired",
      stale: true,
      status: "stale",
    };
  }

  if (
    isRuntimeTransitionStatus(snapshot.status) &&
    input.nowMs - snapshot.statusChangedAtMs > input.staleAfterMs
  ) {
    return {
      reason: snapshot.lastErrorCode ?? `${snapshot.status}_stale`,
      stale: true,
      status: "stale",
    };
  }

  if (snapshot.status !== "running") {
    return {
      reason: snapshot.lastErrorCode,
      stale: false,
      status: snapshot.status,
    };
  }

  const heartbeatReferenceMs = snapshot.lastHeartbeatAtMs ?? snapshot.statusChangedAtMs;

  if (input.nowMs - heartbeatReferenceMs > input.staleAfterMs) {
    return {
      reason: "heartbeat_stale",
      stale: true,
      status: "stale",
    };
  }

  return {
    reason: null,
    stale: false,
    status: "running",
  };
}
import type { ChannelBindingId } from "@mosoo/id";
