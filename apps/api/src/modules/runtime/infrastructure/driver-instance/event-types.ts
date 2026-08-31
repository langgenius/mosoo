import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { SessionType } from "@mosoo/contracts/session";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import type {
  AccountId,
  AgentId,
  ProjectId,
  DriverCommandId,
  PlatformId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import type {
  SessionDeliveryEvent,
  SessionLiveState,
} from "../../../sessions/application/session-live-state.service";

export type { SessionLiveState };

export interface CanonicalDriverEventEnvelope {
  readonly event: RuntimeEventEnvelope;
  readonly eventId: string;
  readonly occurredAt?: string | null | undefined;
}

export interface HostDriverEventBatchInput {
  readonly driverInstanceId: string;
  readonly events: readonly CanonicalDriverEventEnvelope[];
}

export interface RuntimeSessionLink {
  agentId: AgentId | null;
  projectId: ProjectId | null;
  callerId: PlatformId | null;
  creatorId: PlatformId | null;
  executionOwnerId: AccountId | null;
  sandboxId: SandboxId | null;
  sandboxKind: AgentKind | null;
  runtimeId: string | null;
  sessionId: SessionId | null;
  sessionRunId: SessionRunId | null;
  sessionRunStatus: SessionRunStatus | null;
  sessionType: SessionType | null;
  traceId: string | null;
  sandboxSubjectKind: SandboxSubjectKind | null;
}

export function runtimeSessionLinkNeedsRefresh(link: RuntimeSessionLink | null): boolean {
  return link !== null && (link.sessionId === null || link.sessionRunId === null);
}

export interface ProjectedRuntimeEventRecord {
  artifactAttemptId?: string | null;
  artifactManifestJson?: string | null;
  artifactManifestSha256?: string | null;
  event: RuntimeEventEnvelope;
  occurredAt: number | null;
  provenMcpCommandId?: DriverCommandId | null;
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

export interface ProjectRuntimeDriverEventsResult {
  finalAssistantMessageId: string | null;
  link: RuntimeSessionLink;
  liveStateChanged: boolean;
  nextLiveState: SessionLiveState | null;
  transitions: RuntimeDriverRunTransition[];
  runtimeEvents: ProjectedRuntimeEventRecord[];
  sessionDeliveryEvents: ProjectedSessionDeliveryEvent[];
}
