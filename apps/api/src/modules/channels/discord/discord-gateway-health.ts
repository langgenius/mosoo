export type DiscordGatewayRuntimeStatus =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "stale"
  | "stopped";

export interface DiscordGatewayRuntimeSnapshot {
  connectedAtMs: number | null;
  heartbeatIntervalMs: number | null;
  lastCloseCode: number | null;
  lastDispatchAtMs: number | null;
  lastErrorCode: string | null;
  lastHeartbeatAckAtMs: number | null;
  lastHeartbeatSentAtMs: number | null;
  resumeGatewayUrl: string | null;
  sequence: number | null;
  sessionId: string | null;
  status: DiscordGatewayRuntimeStatus;
  statusChangedAtMs: number;
}

export interface DiscordGatewayHealthSummary {
  reason: string | null;
  stale: boolean;
  status: DiscordGatewayRuntimeStatus;
}

export function summarizeDiscordGatewayHealth(
  snapshot: DiscordGatewayRuntimeSnapshot,
  input: {
    nowMs: number;
    staleAfterMs: number;
  },
): DiscordGatewayHealthSummary {
  if (snapshot.status !== "connected") {
    const stale =
      (snapshot.status === "connecting" || snapshot.status === "reconnecting") &&
      input.nowMs - snapshot.statusChangedAtMs > input.staleAfterMs;

    if (stale) {
      return {
        reason: snapshot.lastErrorCode ?? `${snapshot.status}_stale`,
        stale: true,
        status: "stale",
      };
    }

    return {
      reason: snapshot.lastErrorCode,
      stale: false,
      status: snapshot.status,
    };
  }

  const heartbeatReferenceMs = snapshot.lastHeartbeatAckAtMs ?? snapshot.connectedAtMs;

  if (heartbeatReferenceMs === null) {
    return {
      reason: "missing_heartbeat_reference",
      stale: true,
      status: "stale",
    };
  }

  if (input.nowMs - heartbeatReferenceMs > input.staleAfterMs) {
    return {
      reason: "heartbeat_ack_stale",
      stale: true,
      status: "stale",
    };
  }

  return {
    reason: null,
    stale: false,
    status: "connected",
  };
}
