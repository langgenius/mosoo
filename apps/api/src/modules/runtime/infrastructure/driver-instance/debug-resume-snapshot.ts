import type { SandboxId } from "@mosoo/id";

export type DriverDebugRecoveryMode = "fresh" | "ready" | "disconnected" | "turn_interrupted";

export interface DriverDebugResumeSnapshot {
  readonly lastEventSeq: number;
  readonly recoveryMode: DriverDebugRecoveryMode;
  readonly sandboxId: SandboxId | null;
}

export function createDriverDebugResumeSnapshot(
  input: DriverDebugResumeSnapshot,
): DriverDebugResumeSnapshot {
  if (!Number.isInteger(input.lastEventSeq) || input.lastEventSeq < 0) {
    throw new Error("Driver debug resume lastEventSeq must be a non-negative integer.");
  }

  return input;
}
