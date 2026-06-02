import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";

const RECOVERABLE_RUNTIME_SUBJECT_ERROR_CODES: ReadonlySet<RuntimeSubjectErrorCode> = new Set([
  "runtime.conversation_mount_failed",
]);

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

export class RuntimeSpaceMountConflictError extends Error {
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
        ? `Runtime space mount path ${input.mountPath} is already in use by ${input.bucket}:${input.prefix}.`
        : `Runtime space mount path ${input.mountPath} is already in use.`;

    super(message, { cause: input.cause });
    this.name = "RuntimeSpaceMountConflictError";
    this.bucket = input.bucket;
    this.mountPath = input.mountPath;
    this.prefix = input.prefix;
  }
}

export function isRecoverableRuntimeSubjectErrorCode(
  code: RuntimeSubjectErrorCode | null,
): boolean {
  return code !== null && RECOVERABLE_RUNTIME_SUBJECT_ERROR_CODES.has(code);
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

  if (error instanceof RuntimeSpaceMountConflictError) {
    return "runtime.space_mount_conflict";
  }

  return "runtime.subject_activation_failed";
}

export function getRuntimeSubjectOperationErrorCode(error: unknown): RuntimeSubjectErrorCode {
  if (error instanceof RuntimeSubjectCheckpointFailedError) {
    return "runtime.subject_checkpoint_failed";
  }

  return "runtime.subject_operation_failed";
}
