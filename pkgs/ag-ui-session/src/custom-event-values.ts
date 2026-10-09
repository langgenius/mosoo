import type {
  SessionCommandOption,
  SessionConfigOption,
  SessionLifecycleStatus,
  SessionModeOption,
  SessionPermissionRequestView,
  SessionRunView,
  SessionUsageSummary,
  SessionViewFile,
  SessionViewPlanEntry,
} from "./live-state";

export interface MosooSessionRunUpdatedValue {
  lifecycle: SessionLifecycleStatus;
  run: SessionRunView;
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

export interface MosooSessionInfraReschedulingValue {
  lastSeen: string | null;
  reason: string | null;
  rescheduleStartedAt: string;
}

export interface MosooSessionInfraRunningValue {
  resumedAt: string;
}

export interface MosooAgentUpdatingValue {
  agentId: string | null;
  operation: "recreateSandbox" | "restartDriver";
  startedAt: string;
}

export interface MosooAgentReadyValue {
  agentId: string | null;
  operation: "recreateSandbox" | "restartDriver";
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

export interface MosooSessionUsageUpdatedValue {
  usage: SessionUsageSummary | null;
}

export interface MosooSessionInfoUpdatedValue {
  title?: string | null;
  updatedAt?: string | null;
}
