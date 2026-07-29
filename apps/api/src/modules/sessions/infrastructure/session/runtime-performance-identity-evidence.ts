import type { DriverRuntimeIdentity } from "@mosoo/agent-driver/orpc";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type {
  DriverInstanceId,
  PlatformId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

export const RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA =
  "mosoo.runtime-performance-identity-evidence.v1";

export function runtimePerformanceIdentityEvidenceEnabled(token: string | undefined): boolean {
  return (token?.trim().length ?? 0) > 0;
}

export interface SessionRuntimePerformanceIdentityEvidence {
  readonly driverCreatedAt: string;
  readonly driverInstanceId: DriverInstanceId;
  readonly runId: SessionRunId;
  readonly runtimeIdentity: DriverRuntimeIdentity;
  readonly sandboxId: SandboxId;
  readonly sandboxKind: "cattle";
  readonly sandboxSessionId: SandboxSessionId;
  readonly sandboxSubjectId: SessionId;
  readonly sandboxSubjectKind: "session";
  readonly schema: typeof RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA;
  readonly sessionId: SessionId;
}

export function createSessionRuntimePerformanceIdentityEvidence(input: {
  readonly driverCreatedAt: number | null;
  readonly driverInstanceId: DriverInstanceId;
  readonly runId: SessionRunId | null;
  readonly runtimeIdentity: DriverRuntimeIdentity;
  readonly sandboxId: SandboxId | null;
  readonly sandboxKind: string | null;
  readonly sandboxSessionId: SandboxSessionId | null;
  readonly sandboxSubjectId: PlatformId | null;
  readonly sandboxSubjectKind: SandboxSubjectKind | null;
  readonly sessionId: SessionId | null;
}): SessionRuntimePerformanceIdentityEvidence | null {
  if (
    input.driverCreatedAt === null ||
    !Number.isSafeInteger(input.driverCreatedAt) ||
    input.driverCreatedAt < 0 ||
    input.runId === null ||
    input.sandboxId === null ||
    input.sandboxKind !== "cattle" ||
    input.sandboxSessionId === null ||
    input.sandboxSubjectId === null ||
    input.sandboxSubjectKind !== "session" ||
    input.sessionId === null ||
    input.sandboxSubjectId !== input.sessionId
  ) {
    return null;
  }

  return {
    driverCreatedAt: new Date(input.driverCreatedAt).toISOString(),
    driverInstanceId: input.driverInstanceId,
    runId: input.runId,
    runtimeIdentity: input.runtimeIdentity,
    sandboxId: input.sandboxId,
    sandboxKind: "cattle",
    sandboxSessionId: input.sandboxSessionId,
    sandboxSubjectId: input.sessionId,
    sandboxSubjectKind: "session",
    schema: RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
    sessionId: input.sessionId,
  };
}

export function runtimePerformanceIdentityEvidenceKey(runId: string): string {
  return `runtime-performance-identity:${runId}`;
}
