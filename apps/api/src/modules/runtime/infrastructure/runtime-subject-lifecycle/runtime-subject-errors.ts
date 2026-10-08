import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";

export class RuntimeSubjectBackupNotReadyError extends Error {
  readonly backupId: string;
  readonly status: string;

  constructor(input: {
    readonly backupId: string;
    readonly runtimeSubjectId: string;
    readonly status: string;
  }) {
    super(
      `Runtime subject ${input.runtimeSubjectId} has last backup ${input.backupId} with status ${input.status}; ready backup is required for restore.`,
    );
    this.name = "RuntimeSubjectBackupNotReadyError";
    this.backupId = input.backupId;
    this.status = input.status;
  }
}

export class RuntimeSubjectCheckpointFailedError extends Error {
  readonly backupId: string | null;
  readonly dir: string | null;

  constructor(input: {
    readonly backupId?: string | null;
    readonly cause: unknown;
    readonly dir?: string | null;
    readonly runtimeSubjectId: string;
  }) {
    const suffix = input.dir ? ` for ${input.dir}` : "";
    super(`Runtime subject ${input.runtimeSubjectId} checkpoint failed${suffix}.`, {
      cause: input.cause,
    });
    this.name = "RuntimeSubjectCheckpointFailedError";
    this.backupId = input.backupId ?? null;
    this.dir = input.dir ?? null;
  }
}

export class RuntimeSubjectRestoreFailedError extends Error {
  readonly backupId: string;

  constructor(input: {
    readonly backupId: string;
    readonly cause: unknown;
    readonly runtimeSubjectId: string;
  }) {
    super(
      `Runtime subject ${input.runtimeSubjectId} restore failed from backup ${input.backupId}.`,
      {
        cause: input.cause,
      },
    );
    this.name = "RuntimeSubjectRestoreFailedError";
    this.backupId = input.backupId;
  }
}

export class RuntimeBucketMountConflictError extends Error {
  readonly bucket: string | null;
  readonly mountPath: string;
  readonly prefix: string | null;

  constructor(input: {
    readonly bucket: string | null;
    readonly cause: unknown;
    readonly mountPath: string;
    readonly prefix: string | null;
  }) {
    const message =
      input.bucket && input.prefix
        ? `Runtime bucket mount path ${input.mountPath} is already in use by ${input.bucket}:${input.prefix}.`
        : `Runtime bucket mount path ${input.mountPath} is already in use.`;

    super(message, { cause: input.cause });
    this.name = "RuntimeBucketMountConflictError";
    this.bucket = input.bucket;
    this.mountPath = input.mountPath;
    this.prefix = input.prefix;
  }
}

export type RuntimeSubjectCapacityScope = "account" | "platform";

export interface RuntimeSubjectCapacityShortfall {
  readonly limit: number;
  readonly scope: RuntimeSubjectCapacityScope;
}

// A full deployment or account quota is a normal, retryable condition; callers
// surface it as such instead of the generic lifecycle-busy failure.
export class RuntimeSubjectCapacityExceededError extends Error {
  readonly limit: number;
  readonly scope: RuntimeSubjectCapacityScope;

  constructor(shortfall: RuntimeSubjectCapacityShortfall) {
    super(
      shortfall.scope === "platform"
        ? "mosoo is at capacity right now. Try again in a few minutes."
        : `You already have ${shortfall.limit} active sessions. Try again in a few minutes, after one of them finishes.`,
    );
    this.name = "RuntimeSubjectCapacityExceededError";
    this.limit = shortfall.limit;
    this.scope = shortfall.scope;
  }
}

export function findRuntimeSubjectCapacityError(
  error: unknown,
): RuntimeSubjectCapacityExceededError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof RuntimeSubjectCapacityExceededError) {
      return current;
    }

    seen.add(current);
    current = current.cause;
  }

  return null;
}

export function getRuntimeSubjectErrorCode(error: unknown): RuntimeSubjectErrorCode {
  if (error instanceof RuntimeSubjectBackupNotReadyError) {
    return "runtime.subject_backup_not_ready";
  }

  if (error instanceof RuntimeSubjectCheckpointFailedError) {
    return "runtime.subject_checkpoint_failed";
  }

  if (error instanceof RuntimeSubjectRestoreFailedError) {
    return "runtime.subject_restore_failed";
  }

  return "runtime.subject_activation_failed";
}

export function getRuntimeSubjectOperationErrorCode(error: unknown): RuntimeSubjectErrorCode {
  if (error instanceof RuntimeSubjectCheckpointFailedError) {
    return "runtime.subject_checkpoint_failed";
  }

  return "runtime.subject_operation_failed";
}
