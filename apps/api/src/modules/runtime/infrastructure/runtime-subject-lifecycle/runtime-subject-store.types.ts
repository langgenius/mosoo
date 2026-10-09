import type {
  SandboxSessionStatus,
  SandboxStatus,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import type {
  AccountId,
  ProjectId,
  PlatformId,
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

export interface RuntimeSubjectActivationRecord {
  readonly claimExpiresAt: number | null;
  readonly claimOwner: string | null;
  readonly id: SandboxId;
  readonly ownerAccountId: AccountId | null;
  readonly projectId: ProjectId | null;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
  readonly status: RuntimeSubjectStatus;
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
  readonly status: SandboxSessionStatus;
  readonly workspaceCheckpointRequired: boolean;
}

export interface RuntimeConversationSessionState {
  readonly sandboxSessionId: SandboxSessionId;
  readonly status: RuntimeConversationSessionRecord["status"];
}

export interface RuntimeSubjectMaintenanceCandidate {
  readonly id: SandboxId;
}

export interface RuntimeSubjectOperationRepairCandidate {
  readonly id: SandboxId;
  readonly operationId: RuntimeOperationId;
  readonly status: RuntimeSubjectOperationStatus;
}

export interface RuntimeRunLeaseInput {
  readonly driverInstanceId: DriverInstanceId;
  readonly runtimeSubjectId: SandboxId;
  readonly sessionId: SessionId;
  readonly sessionRunId: SessionRunId;
}
