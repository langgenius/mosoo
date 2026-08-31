import type { DriverInstanceId, SandboxId } from "@mosoo/id";

export const SESSION_ARCHIVE_CLEANUP_STEPS = [
  "archive_session_row",
  "close_viewer_sockets",
  "load_runtime_targets",
  "stop_live_drivers",
  "normalize_runtime_lifecycle",
  "close_sandbox_session",
  "complete_archive_session",
] as const;

export const SESSION_DELETE_CLEANUP_STEPS = [
  "archive_session_row",
  "load_cleanup_targets",
  "stop_live_drivers",
  "normalize_runtime_lifecycle",
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

export type SessionArchiveCleanupStepOutcome = {
  step: SessionArchiveCleanupStep;
  status: "completed" | "skipped";
};

export type SessionDeleteCleanupStepOutcome = {
  step: SessionDeleteCleanupStep;
  status: "completed" | "skipped";
};

export interface SessionArchiveCleanupTargets {
  liveDriverInstances: readonly { generation: number; id: DriverInstanceId }[];
  sandboxId: SandboxId | null;
}

export interface SessionDeleteCleanupTargets {
  associatedDriverInstances: readonly { generation: number; id: DriverInstanceId }[];
  liveDriverInstances: readonly { generation: number; id: DriverInstanceId }[];
  sandboxId: SandboxId | null;
}
