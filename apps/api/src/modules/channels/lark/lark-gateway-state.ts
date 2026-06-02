import type { ChannelConnectionStatePayload } from "../application/channel-connection-state.service";
import { LARK_LC_DEFAULT_HEARTBEAT_INTERVAL_MS } from "./lark-long-connection-client";

export const LARK_GATEWAY_LEASE_DURATION_MS = 2 * 60 * 1000;
export const LARK_GATEWAY_RECONNECT_INITIAL_BACKOFF_MS = 5_000;
const LARK_GATEWAY_RECONNECT_MAX_BACKOFF_MS = 60_000;
export const LARK_GATEWAY_MAX_CONSECUTIVE_RECONNECT_FAILURES = 6;
export const LARK_GATEWAY_PROVIDER = "lark" as const;
export const LARK_GATEWAY_STORAGE_BINDING_KEY = "bindingId";
export const LARK_GATEWAY_STORAGE_OWNER_KEY = "ownerId";

export type LarkGatewayStatus = "connected" | "connecting" | "reconnecting" | "stopped" | "stale";

export interface LarkGatewayResumeState {
  readonly consecutiveReconnectFailures: number;
  readonly heartbeatIntervalMs: number;
  readonly lastConnectedAtMs: number | null;
  readonly lastErrorCode: string | null;
  readonly reconnectBackoffMs: number;
  readonly status: LarkGatewayStatus;
  readonly statusChangedAtMs: number;
}

export function defaultResumeState(nowMs: number): LarkGatewayResumeState {
  return {
    consecutiveReconnectFailures: 0,
    heartbeatIntervalMs: LARK_LC_DEFAULT_HEARTBEAT_INTERVAL_MS,
    lastConnectedAtMs: null,
    lastErrorCode: null,
    reconnectBackoffMs: LARK_GATEWAY_RECONNECT_INITIAL_BACKOFF_MS,
    status: "stopped",
    statusChangedAtMs: nowMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown>, field: string): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function readStringOrNull(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function readGatewayStatus(value: unknown): LarkGatewayStatus | null {
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

export function parseResumeState(json: string, nowMs: number): LarkGatewayResumeState {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
      return defaultResumeState(nowMs);
    }
    const status = readGatewayStatus(parsed["status"]);
    const statusChangedAtMs = readNumber(parsed, "statusChangedAtMs");
    if (status === null || statusChangedAtMs === null) {
      return defaultResumeState(nowMs);
    }
    return {
      consecutiveReconnectFailures: readNumber(parsed, "consecutiveReconnectFailures") ?? 0,
      heartbeatIntervalMs:
        readNumber(parsed, "heartbeatIntervalMs") ?? LARK_LC_DEFAULT_HEARTBEAT_INTERVAL_MS,
      lastConnectedAtMs: readNumber(parsed, "lastConnectedAtMs"),
      lastErrorCode: readStringOrNull(parsed, "lastErrorCode"),
      reconnectBackoffMs:
        readNumber(parsed, "reconnectBackoffMs") ?? LARK_GATEWAY_RECONNECT_INITIAL_BACKOFF_MS,
      status,
      statusChangedAtMs,
    };
  } catch {
    return defaultResumeState(nowMs);
  }
}

export function serializeResumeState(state: LarkGatewayResumeState): string {
  return JSON.stringify(state);
}

export function mapResumeToRuntimeStatus(
  status: LarkGatewayStatus,
): ChannelConnectionStatePayload["status"] {
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

export function nextReconnectBackoff(previousMs: number): number {
  const doubled = previousMs * 2;
  return doubled > LARK_GATEWAY_RECONNECT_MAX_BACKOFF_MS
    ? LARK_GATEWAY_RECONNECT_MAX_BACKOFF_MS
    : doubled;
}
