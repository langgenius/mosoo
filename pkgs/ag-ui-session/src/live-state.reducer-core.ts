import type { SessionLiveState } from "./live-state";

export type JsonObject = Record<string, unknown>;

export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

export function touchSessionLiveState(state: SessionLiveState): SessionLiveState {
  return {
    ...state,
    updatedAt: currentIsoTimestamp(),
  };
}

export function defaultInfraState(): SessionLiveState["infra"] {
  return {
    lastFailureMessage: null,
    lastFailureReason: null,
    lastSeen: null,
    reconnecting: false,
  };
}

export function isTerminalRunStatus(status: SessionLiveState["run"]["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired"
  );
}

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
