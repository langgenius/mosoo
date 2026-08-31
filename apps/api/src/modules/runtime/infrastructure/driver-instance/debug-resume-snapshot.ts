import type { SandboxId } from "@mosoo/id";

export type DriverDebugRecoveryMode = "fresh" | "ready" | "disconnected" | "turn_interrupted";

export interface DriverDebugResumeSnapshot {
  readonly recoveryMode: DriverDebugRecoveryMode;
  readonly sandboxId: SandboxId | null;
}

export function createDriverDebugResumeSnapshot(
  input: DriverDebugResumeSnapshot,
): DriverDebugResumeSnapshot {
  return input;
}
