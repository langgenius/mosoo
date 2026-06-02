import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
  DriverRuntime,
} from "@mosoo/driver-protocol";
import type {
  AgentId,
  DriverInstanceId,
  FileId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { HydratedSessionRunContext } from "../session-definition/session-execution.types";
import type { RuntimeTimingSnapshot } from "../session-runs/session-runtime-timing";

export interface RuntimeExecutionPlaneRunLease {
  driverInstanceId: DriverInstanceId;
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  timing: RuntimeTimingSnapshot;
  release(): void;
}

export interface PrepareRuntimeRunInput {
  attachmentIds: FileId[];
  profile: HydratedSessionRunContext["profile"] & {
    runtimeId: DriverRuntime;
  };
  resolvedMcpServers: HydratedSessionRunContext["mcpServers"];
  resolvedSkillCatalog: HydratedSessionRunContext["skillCatalog"];
  resolvedSkills: HydratedSessionRunContext["skills"];
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  traceId: string;
  organizationAccessSnapshot: HydratedSessionRunContext["organizationAccessSnapshot"];
  onBootPayloadPrepared?: (payload: DriverBootPayload) => Promise<void>;
}

export interface DispatchRuntimeTurnInput {
  attachmentIds: FileId[];
  driverInstanceId: DriverInstanceId;
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  prompt: string;
  sessionRunId: SessionRunId;
}

export interface RuntimeExecutionTerminalOptions {
  cols?: number;
  rows?: number;
}

export interface StopRuntimeSubjectDriversInput {
  operationId?: RuntimeOperationId;
  runtimeSubjectId: SandboxId;
  preserveSessionLifecycle?: boolean;
  reason: string;
  targets?: readonly RuntimeSubjectOperationSessionTarget[];
  terminalRun?: {
    error?: RunError | null;
    status: Extract<SessionRunStatus, "cancelled" | "failed">;
  };
}

export interface RuntimeSubjectOperationInput {
  operationId: RuntimeOperationId;
  runtimeSubjectId: SandboxId;
  reason: string;
  targets: readonly RuntimeSubjectOperationSessionTarget[];
  terminalRun: {
    error?: RunError | null;
    status: Extract<SessionRunStatus, "cancelled" | "failed">;
  };
}

export interface RuntimeSubjectOperationSessionTarget {
  readonly agentId: AgentId | null;
  readonly sessionId: SessionId;
}

export interface RuntimeExecutionPlaneAdapter {
  connectTerminal(
    bindings: ApiBindings,
    input: {
      runtimeSubjectId: SandboxId;
      options?: RuntimeExecutionTerminalOptions;
      request: Request;
      terminalSessionId?: string;
    },
  ): Promise<Response>;
  dispatchTurn(bindings: ApiBindings, input: DispatchRuntimeTurnInput): Promise<void>;
  materializeActiveSessionResources(
    bindings: ApiBindings,
    input: { sessionId: SessionId },
  ): Promise<void>;
  prepareRun(
    bindings: ApiBindings,
    requestUrl: string,
    input: PrepareRuntimeRunInput,
  ): Promise<RuntimeExecutionPlaneRunLease>;
  recreateSubjectPreservingState(
    bindings: ApiBindings,
    input: RuntimeSubjectOperationInput,
  ): Promise<void>;
  resetSubjectAgentState(bindings: ApiBindings, input: RuntimeSubjectOperationInput): Promise<void>;
  stopSubjectDrivers(bindings: ApiBindings, input: StopRuntimeSubjectDriversInput): Promise<void>;
}
