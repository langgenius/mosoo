import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { SessionSummary, SessionType } from "@mosoo/contracts/session";

export interface SessionConfigurationFreshnessInput {
  activeSession: SessionSummary | null;
  activeSessionRevision: string | null;
  configurationChangedAt: string | null;
  configurationRevisionKey: string | null;
  requireFreshConfiguration: boolean;
}

export interface ComposerSendBlockInput {
  configurationRefreshRequired: boolean;
  lifecycle: SessionLiveState["lifecycle"];
  readinessBlockMessage: string | null;
  reconnecting: boolean;
  sending: boolean;
  streaming: boolean;
  typedText: string;
}

export interface RuntimeReadyWaitInput {
  sessionType: SessionType;
  waitForRuntimeReadyOnNewSession: boolean;
}

export function toAgentSessions(sessions: SessionSummary[], agentId: string): SessionSummary[] {
  return sessions
    .filter((session) => session.agentId === agentId)
    .toSorted(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

export function getReadinessBlockMessage(readiness: AgentReadiness | null): string | null {
  if (readiness === null || readiness.issues.length === 0 || readiness.ready) {
    return null;
  }

  return readiness.issues.find((issue) => issue.severity === "error")?.message ?? null;
}

export function hasStaleSessionConfiguration(input: SessionConfigurationFreshnessInput): boolean {
  if (!input.requireFreshConfiguration || input.activeSession === null) {
    return false;
  }

  if (
    input.activeSessionRevision !== null &&
    input.configurationRevisionKey !== null &&
    input.activeSessionRevision !== input.configurationRevisionKey
  ) {
    return true;
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
    input.configurationRefreshRequired ||
    input.readinessBlockMessage !== null
  );
}

export function shouldWaitForRuntimeReadyOnNewSession(input: RuntimeReadyWaitInput): boolean {
  return input.waitForRuntimeReadyOnNewSession && input.sessionType === "preview";
}

export function createSessionAutoTitle(typedText: string): string {
  return typedText.length > 30 ? `${typedText.slice(0, 27)}...` : typedText;
}

function parseTimestampMs(value: string | null): number | null {
  if (value === null || value.length === 0) {
    return null;
  }

  const timestampMs = new Date(value).getTime();
  return Number.isNaN(timestampMs) ? null : timestampMs;
}
