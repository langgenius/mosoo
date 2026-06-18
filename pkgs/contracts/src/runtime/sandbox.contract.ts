import { type } from "arktype";

import type { AgentKind } from "../agent/agent.contract";
import type {
  DriverInstanceId,
  PlatformId,
  SandboxBackupId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "../id/id.contract";

export const SandboxSubjectKind = type('"user" | "agent" | "session"');
export type SandboxSubjectKind = typeof SandboxSubjectKind.infer;

export const SandboxStatus = type(
  '"cold" | "restoring" | "active" | "backing_up" | "destroying" | "error"',
);
export type SandboxStatus = typeof SandboxStatus.infer;

export const SandboxSessionStatus = type('"active" | "closed" | "error"');
export type SandboxSessionStatus = typeof SandboxSessionStatus.infer;

export const SandboxBackupStatus = type('"creating" | "ready" | "restoring" | "failed" | "pruned"');
export type SandboxBackupStatus = typeof SandboxBackupStatus.infer;

export const RuntimeSubjectErrorCode = type(
  '"runtime.conversation_mount_failed" | "runtime.subject_activation_failed" | "runtime.subject_backup_not_ready" | "runtime.subject_checkpoint_failed" | "runtime.subject_operation_failed" | "runtime.subject_restore_failed"',
);
export type RuntimeSubjectErrorCode = typeof RuntimeSubjectErrorCode.infer;

export const DriverInstanceStatus = type(
  '"provisioning" | "connecting" | "ready" | "stopping" | "stopped" | "failed"',
);
export type DriverInstanceStatus = typeof DriverInstanceStatus.infer;

export interface SandboxSummary {
  id: SandboxId;
  inactiveDeadlineAt: string | null;
  kind: AgentKind;
  lastBackupId: SandboxBackupId | null;
  lastError: string | null;
  lastRestoreBackupId: SandboxBackupId | null;
  status: SandboxStatus;
  subjectId: PlatformId;
  subjectKind: SandboxSubjectKind;
}

export interface SandboxSessionSummary {
  sandboxSessionId: SandboxSessionId;
  cwd: string;
  id: SessionId;
  originJson: string;
  sandboxId: SandboxId;
  status: SandboxSessionStatus;
}

export interface SandboxBackupSummary {
  dir: string;
  errorMessage: string | null;
  id: SandboxBackupId;
  keep: boolean;
  sandboxId: SandboxId;
  status: SandboxBackupStatus;
  ttlSeconds: number;
}

export interface DriverInstanceSummary {
  closeReason: string | null;
  connectionId: string | null;
  driverVersion: string | null;
  heartbeatCount: number;
  id: DriverInstanceId;
  lastError: string | null;
  lastHeartbeatAt: string | null;
  processId: string | null;
  restartCount: number;
  sandboxId: SandboxId;
  sandboxSessionId: SessionId;
  sessionRunId: SessionRunId | null;
  status: DriverInstanceStatus;
}
