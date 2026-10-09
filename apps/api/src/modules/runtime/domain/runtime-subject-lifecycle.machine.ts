import type { SandboxStatus } from "@mosoo/contracts/sandbox";

export const RUNTIME_SUBJECT_CLAIMABLE_STATUSES = [
  "active",
  "cold",
] as const satisfies readonly SandboxStatus[];

// There is no dedicated failure state. A failed lifecycle step makes the
// container untrustworthy, so activation first enters `destroying`. Successful
// teardown returns it to `cold`; a failed/timeout teardown stays `destroying`
// with its operation id so maintenance can resume the same repair.
export const RUNTIME_SUBJECT_OPERATION_STATUSES = [
  "backing_up",
  "destroying",
] as const satisfies readonly SandboxStatus[];

export type RuntimeSubjectOperationStatus = (typeof RUNTIME_SUBJECT_OPERATION_STATUSES)[number];
