import type { ChannelConnectionOwnerSnapshot } from "../application/channel-connection-health";
import type { ChannelConnectionStatePayload } from "../application/channel-connection-state.service";
import type { DiscordGatewayResumeState } from "./discord-gateway-client";
import type {
  DiscordGatewayRuntimeSnapshot,
  DiscordGatewayRuntimeStatus,
} from "./discord-gateway-health";

interface SerializedDiscordGatewayRuntimeState {
  readonly connectedAtMs: number | null;
  readonly heartbeatIntervalMs: number | null;
  readonly lastCloseCode: number | null;
  readonly lastDispatchAtMs: number | null;
  readonly lastErrorCode: string | null;
  readonly lastHeartbeatAckAtMs: number | null;
  readonly lastHeartbeatSentAtMs: number | null;
  readonly resumeGatewayUrl: string | null;
  readonly sequence: number | null;
  readonly sessionId: string | null;
  readonly status: DiscordGatewayRuntimeStatus;
  readonly statusChangedAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function readNullableNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];

  if (candidate === null || candidate === undefined) {
    return null;
  }

  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function readDiscordGatewayStatus(value: unknown): DiscordGatewayRuntimeStatus | null {
  switch (value) {
    case "connected":
    case "connecting":
    case "reconnecting":
    case "stale":
    case "stopped":
      return value;
    default:
      return null;
  }
}

function mapDiscordGatewayStatus(
  status: DiscordGatewayRuntimeStatus,
): ChannelConnectionOwnerSnapshot["status"] {
  switch (status) {
    case "connected":
      return "running";
    case "connecting":
      return "starting";
    case "reconnecting":
      return "reconnecting";
    case "stale":
      return "stale";
    case "stopped":
      return "stopped";
  }
}

function parseSerializedDiscordGatewayRuntimeState(
  value: unknown,
): SerializedDiscordGatewayRuntimeState | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = readDiscordGatewayStatus(value["status"]);
  const statusChangedAtMs = readNullableNumber(value, "statusChangedAtMs");

  if (status === null || statusChangedAtMs === null) {
    return null;
  }

  return {
    connectedAtMs: readNullableNumber(value, "connectedAtMs"),
    heartbeatIntervalMs: readNullableNumber(value, "heartbeatIntervalMs"),
    lastCloseCode: readNullableNumber(value, "lastCloseCode"),
    lastDispatchAtMs: readNullableNumber(value, "lastDispatchAtMs"),
    lastErrorCode: readString(value, "lastErrorCode"),
    lastHeartbeatAckAtMs: readNullableNumber(value, "lastHeartbeatAckAtMs"),
    lastHeartbeatSentAtMs: readNullableNumber(value, "lastHeartbeatSentAtMs"),
    resumeGatewayUrl: readString(value, "resumeGatewayUrl"),
    sequence: readNullableNumber(value, "sequence"),
    sessionId: readString(value, "sessionId"),
    status,
    statusChangedAtMs,
  };
}

function serializeDiscordGatewayRuntimeState(snapshot: DiscordGatewayRuntimeSnapshot): string {
  const state: SerializedDiscordGatewayRuntimeState = {
    connectedAtMs: snapshot.connectedAtMs,
    heartbeatIntervalMs: snapshot.heartbeatIntervalMs,
    lastCloseCode: snapshot.lastCloseCode,
    lastDispatchAtMs: snapshot.lastDispatchAtMs,
    lastErrorCode: snapshot.lastErrorCode,
    lastHeartbeatAckAtMs: snapshot.lastHeartbeatAckAtMs,
    lastHeartbeatSentAtMs: snapshot.lastHeartbeatSentAtMs,
    resumeGatewayUrl: snapshot.resumeGatewayUrl,
    sequence: snapshot.sequence,
    sessionId: snapshot.sessionId,
    status: snapshot.status,
    statusChangedAtMs: snapshot.statusChangedAtMs,
  };

  return JSON.stringify(state);
}

export function createDiscordGatewayRuntimeStatePayload(
  snapshot: DiscordGatewayRuntimeSnapshot,
): ChannelConnectionStatePayload {
  return {
    lastErrorCode: snapshot.lastErrorCode,
    lastHeartbeatAtMs: snapshot.lastHeartbeatAckAtMs ?? snapshot.lastHeartbeatSentAtMs,
    lastInboundAtMs: snapshot.lastDispatchAtMs,
    lastPollAtMs: null,
    runtimeStateJson: serializeDiscordGatewayRuntimeState(snapshot),
    status: mapDiscordGatewayStatus(snapshot.status),
    statusChangedAtMs: snapshot.statusChangedAtMs,
  };
}

export function parseDiscordGatewayResumeStateFromRuntimeState(
  runtimeStateJson: string,
): DiscordGatewayResumeState | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(runtimeStateJson);
  } catch {
    return null;
  }

  const state = parseSerializedDiscordGatewayRuntimeState(parsed);

  if (!state || !state.resumeGatewayUrl || state.sequence === null || !state.sessionId) {
    return null;
  }

  return {
    resumeGatewayUrl: state.resumeGatewayUrl,
    sequence: state.sequence,
    sessionId: state.sessionId,
  };
}
