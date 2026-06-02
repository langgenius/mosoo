import type { FileApiErrorDetails, FileErrorCode, FileErrorResponse } from "@mosoo/contracts/file";

const EMPTY_FILE_ERROR_DETAILS: FileApiErrorDetails = {};

export class FileControlError extends Error {
  readonly code: FileErrorCode;
  readonly details: FileApiErrorDetails;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    status: number,
    code: FileErrorCode,
    message: string,
    retryable = false,
    details: FileApiErrorDetails = EMPTY_FILE_ERROR_DETAILS,
  ) {
    super(message);
    this.name = "FileControlError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.status = status;
  }
}

export function isRetryableFileControlError(error: unknown): error is FileControlError {
  return error instanceof FileControlError && error.retryable;
}

export function createFileInvalidRequestError(message: string): FileControlError {
  return new FileControlError(400, "file_invalid_request", message);
}

export function createFileConflictError(message: string): FileControlError {
  return new FileControlError(409, "file_conflict", message);
}

export function createFileNotFoundError(message: string): FileControlError {
  return new FileControlError(404, "file_not_found", message);
}

export function createFileForbiddenError(message: string): FileControlError {
  return new FileControlError(403, "file_forbidden", message);
}

export function createUploadExpiredError(): FileControlError {
  return new FileControlError(410, "file_upload_expired", "Upload session has expired.");
}

export function createUploadInvalidStateError(message: string): FileControlError {
  return new FileControlError(409, "file_upload_invalid_state", message);
}

export function createUploadInvalidPartError(message: string): FileControlError {
  return new FileControlError(400, "file_upload_invalid_part", message);
}

export function createUploadContentMissingError(message: string): FileControlError {
  return new FileControlError(400, "file_upload_content_missing", message);
}

export function createUploadIntegrityError(message: string): FileControlError {
  return new FileControlError(400, "file_upload_integrity_failed", message);
}

export function createFilePreconditionFailedError(message: string): FileControlError {
  return new FileControlError(412, "file_precondition_failed", message);
}

export function createFileMoveFailedError(message: string, retryable = true): FileControlError {
  return new FileControlError(503, "file_move_failed", message, retryable);
}

export function createFileDeleteFailedError(message: string, retryable = true): FileControlError {
  return new FileControlError(503, "file_delete_failed", message, retryable);
}

export function createFileErrorResponse(error: FileControlError): FileErrorResponse {
  return {
    error: {
      code: error.code,
      details: error.details,
      message: error.message,
      retryable: error.retryable,
      status: error.status,
    },
  };
}

export function createUnexpectedFileError(error: unknown): FileControlError {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "File storage is temporarily unavailable.";

  return new FileControlError(503, "file_storage_unavailable", message, true);
}

export function toFileStorageMessage(error: unknown, defaultMessage: string): string {
  const message = error instanceof Error ? error.message.trim() : "";

  return message.length > 0 ? message : defaultMessage;
}
