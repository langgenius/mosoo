import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import type { AccountId, AgentId, PlatformId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type {
  SessionDeliveryEvent,
  SessionLiveState,
} from "../../../sessions/application/session-live-state.service";

export type { SessionLiveState };

export interface RuntimeSessionLink {
  agentId: AgentId | null;
  callerId: PlatformId | null;
  creatorId: PlatformId | null;
  executionOwnerId: AccountId | null;
  sandboxId: SandboxId | null;
  sandboxKind: AgentKind | null;
  sessionId: SessionId | null;
  sessionRunId: SessionRunId | null;
  sessionRunStatus: SessionRunStatus | null;
  traceId: string | null;
  sandboxSubjectKind: SandboxSubjectKind | null;
}

export function runtimeSessionLinkNeedsRefresh(link: RuntimeSessionLink | null): boolean {
  return link !== null && (link.sessionId === null || link.sessionRunId === null);
}

export interface ProjectedRuntimeEventRecord {
  event: RuntimeEventEnvelope;
  occurredAt: number | null;
  sourceEventId: string | null;
}

export interface ProjectedSessionDeliveryEvent {
  event: SessionDeliveryEvent;
  occurredAt: number | null;
  sourceEventId: string | null;
}

export interface RuntimeDriverRunTransition {
  error?: {
    code: string;
    details: Record<string, string | number | boolean | null>;
    message: string;
    retryable: boolean;
  };
  status: "cancelled" | "completed" | "failed" | "running";
}

export interface AppRuntimeDriverEventsResult {
  link: RuntimeSessionLink;
  liveStateChanged: boolean;
  nextLiveState: SessionLiveState | null;
  sessionTitle: string | null;
  transitions: RuntimeDriverRunTransition[];
  usage: SessionUsageSummary | null;
  runtimeEvents: ProjectedRuntimeEventRecord[];
  sessionDeliveryEvents: ProjectedSessionDeliveryEvent[];
}
