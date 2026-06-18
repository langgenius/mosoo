import type {
  FileApiErrorDetails,
  FileErrorCode,
  FileErrorResponse,
  FileScopeKind,
} from "@mosoo/contracts/file";

const TERMINAL_FILE_ERROR_CODES = new Set<FileErrorCode>([
  "file_conflict",
  "file_forbidden",
  "file_invalid_request",
  "file_not_found",
  "file_precondition_failed",
  "file_unauthorized",
  "file_upload_content_missing",
  "file_upload_expired",
  "file_upload_integrity_failed",
  "file_upload_invalid_part",
  "file_upload_invalid_state",
]);

interface FileErrorPayload {
  code: FileErrorCode;
  details: FileApiErrorDetails;
  message: string;
  retryable: boolean;
  status: number;
}

export interface FileUploadCompletionEventDetail {
  fileId: string;
  scopeId: string | null;
  scopeKind: FileScopeKind;
}

export interface FileUploadBatchResult {
  error: FileApiError | null;
  failedFile?: File | undefined;
  failedFileIndex?: number | undefined;
  failedFileName: string | null;
  failedLogicalPath?: string | undefined;
  remainingFiles?: File[] | undefined;
  skippedCount: number;
  successCount: number;
  uploaded: string[];
}

export interface FileUploadRecoveryCandidate {
  fileId: string;
  fileName: string;
  scopeId: string | null;
  scopeKind: FileScopeKind;
}

export interface FileUploadRecoveryScanResult {
  candidates: FileUploadRecoveryCandidate[];
}

export interface FileUploadResumeResult {
  error: FileApiError | null;
  fileId: string;
  scopeId: string | null;
  scopeKind: FileScopeKind;
  status: "completed" | "removed_terminal" | "retryable_error";
}

export class FileApiError extends Error {
  public readonly code: FileErrorCode;
  public readonly details: FileApiErrorDetails;
  public readonly retryable: boolean;
  public readonly status: number;

  public constructor(payload: FileErrorPayload) {
    super(payload.message);
    this.name = "FileApiError";
    this.code = payload.code;
    this.details = payload.details;
    this.retryable = payload.retryable;
    this.status = payload.status;
  }
}

export function createFileApiError(
  payload: Partial<FileErrorPayload> & { status: number },
): FileApiError {
  return new FileApiError({
    code: payload.code ?? "file_storage_unavailable",
    details: payload.details ?? {},
    message: payload.message ?? "File storage is temporarily unavailable.",
    retryable: payload.retryable ?? payload.status >= 500,
    status: payload.status,
  });
}

function isFileErrorPayload(payload: unknown): payload is FileErrorResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const error = Reflect.get(payload, "error");
  return Boolean(
    error && typeof error === "object" && typeof Reflect.get(error, "code") === "string",
  );
}

export async function parseFileApiError(response: Response): Promise<FileApiError> {
  try {
    const payload: unknown = await response.json();

    if (isFileErrorPayload(payload)) {
      return createFileApiError(payload.error);
    }
  } catch {
    // Ignore invalid JSON payloads and fall back to HTTP metadata.
  }

  return createFileApiError({
    message: `${response.status} ${response.statusText}`,
    retryable: response.status >= 500,
    status: response.status,
  });
}

export function isTerminalFileApiError(error: unknown): error is FileApiError {
  return error instanceof FileApiError && TERMINAL_FILE_ERROR_CODES.has(error.code);
}
