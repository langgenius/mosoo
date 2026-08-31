import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  RuntimeSubjectErrorCode,
  SandboxBackupStatus,
  SandboxOperationKind,
  SandboxSessionStatus,
  SandboxStatus,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import type {
  AccountId,
  AgentId,
  ProjectId,
  DriverInstanceId,
  PlatformId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import type { RuntimeSubjectRecoverableOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";

export type RuntimeSubjectStatus = SandboxStatus;

export interface RuntimeSubjectRecord {
  readonly agentId: AgentId | null;
  readonly projectId: ProjectId | null;
  readonly id: SandboxId;
  readonly incarnation: number;
  readonly kind: AgentKind;
  readonly networkConstraintsHash: string | null;
  readonly ownerAccountId: AccountId | null;
  readonly status: RuntimeSubjectStatus;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
}

export interface RuntimeSubjectActivationRecord {
  readonly agentId: AgentId | null;
  readonly projectId: ProjectId | null;
  readonly claimExpiresAt: number | null;
  readonly claimOwner: string | null;
  readonly id: SandboxId;
  readonly incarnation: number;
  readonly kind: AgentKind;
  readonly lastError: string | null;
  readonly lastErrorCode: RuntimeSubjectErrorCode | null;
  readonly lastBackup: RuntimeSubjectBackupRecord | null;
  readonly lastReadyBackup: ReadyRuntimeSubjectBackupRecord | null;
  readonly networkConstraintsHash: string | null;
  readonly ownerAccountId: AccountId | null;
  readonly operationId: RuntimeOperationId | null;
  readonly operationKind: SandboxOperationKind | null;
  readonly status: RuntimeSubjectStatus;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
}

export interface RuntimeSubjectOperationLease {
  readonly claimExpiresAt: number;
  readonly claimOwner: string;
  readonly incarnation: number;
  readonly kind: SandboxOperationKind;
  readonly operationId: RuntimeOperationId;
  readonly status: RuntimeSubjectRecoverableOperationStatus;
}

export interface RuntimeSubjectBackupRecord {
  readonly dir: string;
  readonly id: SandboxBackupId;
  readonly status: SandboxBackupStatus;
}

export interface ReadyRuntimeSubjectBackupRecord {
  readonly dir: string;
  readonly id: SandboxBackupId;
}

export interface RuntimeConversationSessionRecord {
  readonly sandboxIncarnation: number;
  readonly sandboxSessionId: SandboxSessionId;
  readonly cwd: string;
  readonly latestReadyBackup: ReadyRuntimeSubjectBackupRecord | null;
  readonly originJson: string;
  readonly sandboxId: SandboxId;
  readonly status: SandboxSessionStatus;
  readonly workspaceCheckpointRequired: boolean;
}

export interface RuntimeConversationSessionState {
  readonly agentId: AgentId | null;
  readonly cleanupOperationId: RuntimeOperationId | null;
  readonly sandboxSessionId: SandboxSessionId;
  readonly sandboxIncarnation: number;
  readonly kind: AgentKind;
  readonly status: RuntimeConversationSessionRecord["status"];
}

export interface PendingRuntimeConversationSessionCleanup extends RuntimeConversationSessionState {
  readonly cleanupOperationId: RuntimeOperationId;
  readonly sandboxId: SandboxId;
  readonly sessionId: SessionId;
  readonly status: "cleanup_pending";
}

export interface RuntimeSubjectMaintenanceCandidate {
  readonly id: SandboxId;
  readonly kind: AgentKind;
}

export interface RuntimeSubjectOperationRepairCandidate {
  readonly claimExpiresAt: number | null;
  readonly claimOwner: string | null;
  readonly id: SandboxId;
  readonly incarnation: number;
  readonly kind: AgentKind;
  readonly operationKind: SandboxOperationKind;
  readonly operationId: RuntimeOperationId;
  readonly status: RuntimeSubjectRecoverableOperationStatus;
}

export interface RuntimeRunLeaseInput {
  readonly driverGeneration: number;
  readonly driverInstanceId: DriverInstanceId;
  readonly runtimeSubjectId: SandboxId;
  readonly runtimeSubjectIncarnation: number;
  readonly sessionId: SessionId;
  readonly sessionRunId: SessionRunId;
}
