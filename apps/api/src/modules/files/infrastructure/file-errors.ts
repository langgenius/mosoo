import type { FileErrorCode, FileErrorResponse } from "@mosoo/contracts/file";

export class FileControlError extends Error {
  readonly code: FileErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, code: FileErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "FileControlError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
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

export function createFileErrorResponse(error: FileControlError): FileErrorResponse {
  return {
    error: {
      code: error.code,
      details: {},
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
