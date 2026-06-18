import type {
  SessionCommandOption,
  SessionConfigOption,
  SessionLifecycleStatus,
  SessionModeOption,
  SessionPermissionRequestView,
  SessionReadinessSnapshotView,
  SessionRunView,
  SessionUsageSummary,
  SessionViewFile,
  SessionViewPlanEntry,
} from "./live-state";

export interface MosooSessionRunUpdatedValue {
  lifecycle: SessionLifecycleStatus;
  run: SessionRunView;
}

export interface MosooSessionSyncRequestValue {
  reason: "manual" | "reconnect";
}

export interface MosooSessionPlanUpdatedValue {
  plan: SessionViewPlanEntry[];
}

export type MosooSessionFileChange =
  | {
      change: "delete";
      fileId: string;
    }
  | {
      change: "upsert";
      file: SessionViewFile;
    };

export interface MosooSessionFilesUpdatedValue {
  change?: MosooSessionFileChange;
  files?: SessionViewFile[];
}

export interface MosooSessionPermissionsUpdatedValue {
  permissionRequests: SessionPermissionRequestView[];
}

export interface MosooSessionReadinessValue {
  readiness: SessionReadinessSnapshotView;
}

export interface MosooSessionInfraReschedulingValue {
  lastSeen: string | null;
  reason: string | null;
  rescheduleStartedAt: string;
}

export interface MosooSessionInfraRunningValue {
  resumedAt: string;
}

export interface MosooAgentUpdatingValue {
  agentId: string;
  operation: "recreateSandbox" | "resetAgentState" | "restartDriver";
  startedAt: string;
}

export interface MosooAgentReadyValue {
  agentId: string;
  operation: "recreateSandbox" | "resetAgentState" | "restartDriver";
  readyAt: string;
}

export interface MosooSessionStoppedValue {
  heartbeatMissedMs?: number | null;
  lastSeen?: string | null;
  message?: string | null;
  reason: string;
}

export interface MosooSessionCommandsUpdatedValue {
  commands: SessionCommandOption[];
}

export interface MosooSessionModeUpdatedValue {
  currentModeId: string | null;
  visibleModes: SessionModeOption[];
}

export interface MosooSessionConfigUpdatedValue {
  configOptions: SessionConfigOption[];
}

export interface MosooSessionConfigTraceMcpServer {
  authorizationState: string;
  credentialRef: "absent" | "redacted";
  name: string;
  serverId: string;
}

export interface MosooSessionConfigTraceBootPayload {
  credentialRefs: "redacted"[];
  cwd: string;
  mcpServers: MosooSessionConfigTraceMcpServer[];
  model: string;
  nativeResumeRef: "absent" | "present";
  provider: string;
  runtimeId: string;
  runtimeTransport: string;
}

export interface MosooSessionConfigTraceValue {
  agentId: string;
  configRevisionId: string | null;
  deploymentVersionId: string | null;
  deploymentVersionNumber: number | null;
  driverBootPayload: MosooSessionConfigTraceBootPayload;
  environmentId: string;
  environmentRevisionId: string;
  runId: string | null;
  sessionId: string;
}

export interface MosooSessionRuntimeTimingPhase {
  durationMs: number;
  name: string;
}

export interface MosooSessionRuntimeTimingValue {
  completedAtMs: number;
  path: "cold" | "warm" | "prewarm" | "unknown";
  phases: MosooSessionRuntimeTimingPhase[];
  runId: string | null;
  sessionId: string;
  source: "api" | "driver";
  stage: "context_hydration" | "driver_backend" | "driver_turn" | "prepare_run" | "prewarm";
  startedAtMs: number;
  totalMs: number;
  traceId: string | null;
}

export interface MosooSessionRuntimeTimelineValue {
  completedAtMs: number;
  durationMs: number;
  path: MosooSessionRuntimeTimingValue["path"];
  runId: string | null;
  sessionId: string;
  source: MosooSessionRuntimeTimingValue["source"];
  stage: MosooSessionRuntimeTimingValue["stage"];
  startedAtMs: number;
  traceId: string | null;
}

export interface MosooSessionUsageUpdatedValue {
  usage: SessionUsageSummary | null;
}

export interface MosooSessionInfoUpdatedValue {
  title?: string | null;
  updatedAt?: string | null;
}
