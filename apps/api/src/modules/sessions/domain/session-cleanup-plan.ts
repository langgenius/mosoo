import type { DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";

export const SESSION_ARCHIVE_CLEANUP_STEPS = [
  "archive_session_row",
  "close_viewer_sockets",
  "load_runtime_targets",
  "stop_live_drivers",
  "normalize_runtime_lifecycle",
  "close_sandbox_session",
] as const;

export const SESSION_DELETE_CLEANUP_STEPS = [
  "archive_session_row",
  "load_cleanup_targets",
  "stop_live_drivers",
  "close_sandbox_session",
  "destroy_driver_objects",
  "destroy_session_object",
  "delete_session_backups",
  "delete_session_files",
  "delete_driver_rows",
  "delete_session_row",
] as const;

export type SessionArchiveCleanupStep = (typeof SESSION_ARCHIVE_CLEANUP_STEPS)[number];
export type SessionDeleteCleanupStep = (typeof SESSION_DELETE_CLEANUP_STEPS)[number];
export type SessionDeleteCleanupStepStatus = "completed" | "skipped";
export type SessionArchiveCleanupStepStatus = "completed" | "skipped";

export interface SessionArchiveCleanupStepOutcome {
  step: SessionArchiveCleanupStep;
  status: SessionArchiveCleanupStepStatus;
}

export interface SessionDeleteCleanupStepOutcome {
  step: SessionDeleteCleanupStep;
  status: SessionDeleteCleanupStepStatus;
}

export interface SessionArchiveCleanupTargets {
  liveDriverInstanceIds: readonly DriverInstanceId[];
  sandboxId: SandboxId | null;
  sessionId: SessionId;
}

export interface SessionDeleteCleanupTargets {
  associatedDriverInstanceIds: readonly DriverInstanceId[];
  liveDriverInstanceIds: readonly DriverInstanceId[];
  sandboxId: SandboxId | null;
  sessionId: SessionId;
}

export function completeSessionArchiveCleanupStep(
  step: SessionArchiveCleanupStep,
): SessionArchiveCleanupStepOutcome {
  return { status: "completed", step };
}

export function completeSessionDeleteCleanupStep(
  step: SessionDeleteCleanupStep,
): SessionDeleteCleanupStepOutcome {
  return { status: "completed", step };
}

export function skipSessionArchiveCleanupStep(
  step: SessionArchiveCleanupStep,
): SessionArchiveCleanupStepOutcome {
  return { status: "skipped", step };
}

export function skipSessionDeleteCleanupStep(
  step: SessionDeleteCleanupStep,
): SessionDeleteCleanupStepOutcome {
  return { status: "skipped", step };
}

export function shouldSkipSessionArchiveCleanupStep(input: {
  step: SessionArchiveCleanupStep;
  targets: SessionArchiveCleanupTargets;
}): boolean {
  switch (input.step) {
    case "close_sandbox_session": {
      return input.targets.sandboxId === null;
    }
    case "stop_live_drivers": {
      return input.targets.liveDriverInstanceIds.length === 0;
    }
    case "archive_session_row":
    case "close_viewer_sockets":
    case "load_runtime_targets":
    case "normalize_runtime_lifecycle": {
      return false;
    }
    default: {
      throw new Error("Unknown session archive cleanup step.");
    }
  }
}

export function shouldSkipSessionDeleteCleanupStep(input: {
  step: SessionDeleteCleanupStep;
  targets: SessionDeleteCleanupTargets;
}): boolean {
  switch (input.step) {
    case "close_sandbox_session": {
      return input.targets.sandboxId === null;
    }
    case "destroy_driver_objects":
    case "stop_live_drivers": {
      return input.targets.liveDriverInstanceIds.length === 0;
    }
    case "delete_driver_rows": {
      return input.targets.associatedDriverInstanceIds.length === 0;
    }
    case "archive_session_row":
    case "delete_session_backups":
    case "delete_session_files":
    case "delete_session_row":
    case "destroy_session_object":
    case "load_cleanup_targets": {
      return false;
    }
    default: {
      throw new Error("Unknown session delete cleanup step.");
    }
  }
}
