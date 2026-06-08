import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  RuntimeSubjectErrorCode,
  SandboxBackupStatus,
  SandboxSessionStatus,
  SandboxStatus,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import type {
  AgentId,
  DriverInstanceId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import type { RuntimeSubjectOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";

export type RuntimeSubjectStatus = SandboxStatus;

export interface RuntimeSubjectRecord {
  readonly id: SandboxId;
  readonly kind: AgentKind;
  readonly status: RuntimeSubjectStatus;
  readonly subjectKind: SandboxSubjectKind;
}

export interface RuntimeSubjectActivationRecord {
  readonly claimExpiresAt: number | null;
  readonly claimOwner: string | null;
  readonly id: SandboxId;
  readonly kind: AgentKind;
  readonly lastError: string | null;
  readonly lastErrorCode: RuntimeSubjectErrorCode | null;
  readonly lastBackup: RuntimeSubjectBackupRecord | null;
  readonly lastReadyBackup: ReadyRuntimeSubjectBackupRecord | null;
  readonly mountedSpaceIds: ReadonlySet<string>;
  readonly status: RuntimeSubjectStatus;
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
  readonly sandboxSessionId: SandboxSessionId;
  readonly cwd: string;
  readonly latestReadyBackup: ReadyRuntimeSubjectBackupRecord | null;
  readonly originJson: string;
  readonly sandboxId: SandboxId;
  readonly spaceAliasesJson: string;
  readonly status: SandboxSessionStatus;
}

export interface RuntimeConversationSessionState {
  readonly agentId: AgentId | null;
  readonly sandboxSessionId: SandboxSessionId;
  readonly kind: AgentKind;
  readonly status: RuntimeConversationSessionRecord["status"];
}

export interface RuntimeSubjectMaintenanceCandidate {
  readonly id: SandboxId;
  readonly kind: AgentKind;
}

export interface RuntimeSubjectOperationRepairCandidate {
  readonly id: SandboxId;
  readonly kind: AgentKind;
  readonly operationId: RuntimeOperationId;
  readonly status: RuntimeSubjectOperationStatus;
}

export interface RuntimeRunLeaseInput {
  readonly driverInstanceId: DriverInstanceId;
  readonly runtimeSubjectId: SandboxId;
  readonly sessionId: SessionId;
  readonly sessionRunId: SessionRunId;
}
