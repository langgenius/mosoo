export type SandboxSubjectKind = "user" | "agent" | "session";

// No failure state: a failed lifecycle step returns the subject to `cold` (no
// live container) with the diagnostic kept in lastError. This removes the
// "failed but reclaimable" contradiction that let a broken container DO be
// reused instead of rebuilt.
export type SandboxStatus = "cold" | "restoring" | "active" | "backing_up" | "destroying";

export type SandboxSessionStatus = "active" | "closed" | "error";

export type SandboxBackupStatus = "creating" | "ready" | "restoring" | "failed" | "pruned";

export type RuntimeSubjectErrorCode =
  | "runtime.conversation_mount_failed"
  | "runtime.subject_activation_failed"
  | "runtime.subject_operation_failed";

export type DriverInstanceStatus = "provisioning" | "connecting" | "ready" | "stopped" | "failed";
