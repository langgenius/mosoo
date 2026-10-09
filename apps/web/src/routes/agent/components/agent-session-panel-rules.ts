import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary } from "@mosoo/contracts/session";

export interface SessionConfigurationFreshnessInput {
  activeSession: SessionSummary | null;
  configurationChangedAt: string | null;
}

export interface ComposerSendBlockInput {
  lifecycle: SessionLiveState["lifecycle"];
  readinessBlockMessage: string | null;
  reconnecting: boolean;
  sending: boolean;
  streaming: boolean;
  typedText: string;
}

export function getReadinessBlockMessage(readiness: AgentReadiness | null): string | null {
  if (readiness === null || readiness.issues.length === 0 || readiness.ready) {
    return null;
  }

  return readiness.issues.find((issue) => issue.severity === "error")?.message ?? null;
}

export function hasStaleSessionConfiguration(input: SessionConfigurationFreshnessInput): boolean {
  if (input.activeSession === null) {
    return false;
  }

  const sessionCreatedAtMs = parseTimestampMs(input.activeSession.createdAt);
  const configurationChangedAtMs = parseTimestampMs(input.configurationChangedAt);

  return (
    sessionCreatedAtMs !== null &&
    configurationChangedAtMs !== null &&
    sessionCreatedAtMs < configurationChangedAtMs
  );
}

export function isComposerSendBlocked(input: ComposerSendBlockInput): boolean {
  if (!input.typedText) {
    return true;
  }

  return (
    input.sending ||
    input.streaming ||
    input.reconnecting ||
    input.lifecycle === "RESCHEDULING" ||
    input.readinessBlockMessage !== null
  );
}

export interface SpeculativeSessionCreateInput {
  activeSessionId: string | null;
  projectId: string | null;
  readinessBlockMessage: string | null;
  sending: boolean;
  sessionListLoaded: boolean;
}

// Preview sessions are reset-scoped and cheap to abandon, so typing may create
// one before the first send.
export function shouldSpeculativelyCreateSessionOnTyping(
  input: SpeculativeSessionCreateInput,
): boolean {
  return (
    input.projectId !== null &&
    input.activeSessionId === null &&
    input.sessionListLoaded &&
    !input.sending &&
    input.readinessBlockMessage === null
  );
}

function parseTimestampMs(value: string | null): number | null {
  if (value === null || value.length === 0) {
    return null;
  }

  const timestampMs = new Date(value).getTime();
  return Number.isNaN(timestampMs) ? null : timestampMs;
}
