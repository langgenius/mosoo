import type { FileUploadSummary } from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/contracts/id";

import { requestJson } from "@/platform/http/file-request";
import {
  createFileApiError,
  FileApiError,
  isTerminalFileApiError,
} from "@/shared/lib/file-api-error";
import type {
  FileUploadRecoveryCandidate,
  FileUploadRecoveryScanResult,
  FileUploadResumeResult,
} from "@/shared/lib/file-api-error";

import {
  getFileUploadSession,
  listFileUploadSessions,
  removeFileUploadSession,
} from "../file-upload.store";
import { runUploadSession } from "./file-upload-client";

export async function inspectRecoverableFileUploads(): Promise<FileUploadRecoveryScanResult> {
  const storedSessions = await listFileUploadSessions();

  const results = await Promise.all(
    storedSessions.map(async (stored): Promise<FileUploadRecoveryCandidate | null> => {
      try {
        const session = await requestJson<FileUploadSummary>(`/files/${stored.fileId}/upload`);

        if (
          session.status === "completed" ||
          session.status === "aborted" ||
          session.status === "expired" ||
          session.status === "failed"
        ) {
          await removeFileUploadSession(stored.fileId);
          return null;
        }

        return {
          fileId: stored.fileId,
          fileName: stored.fileName,
        };
      } catch (error) {
        if (isTerminalFileApiError(error)) {
          await removeFileUploadSession(stored.fileId);
          return null;
        }

        return {
          fileId: stored.fileId,
          fileName: stored.fileName,
        };
      }
    }),
  );

  return {
    candidates: results.filter((candidate): candidate is FileUploadRecoveryCandidate =>
      Boolean(candidate),
    ),
  };
}

export async function discardStoredFileUploads(fileIds: FileId[]): Promise<void> {
  await Promise.all(fileIds.map((fileId) => removeFileUploadSession(fileId)));
}

export async function resumeStoredFileUpload(fileId: FileId): Promise<FileUploadResumeResult> {
  const stored = await getFileUploadSession(fileId);

  if (!stored) {
    throw createFileApiError({
      code: "file_not_found",
      message: `Upload file ${fileId} was not found.`,
      retryable: false,
      status: 404,
    });
  }

  let session: FileUploadSummary;

  try {
    session = await requestJson<FileUploadSummary>(`/files/${fileId}/upload`);
  } catch (error) {
    if (isTerminalFileApiError(error)) {
      await removeFileUploadSession(fileId);
      return {
        error,
        fileId: stored.fileId,
        status: "removed_terminal",
      };
    }

    return {
      error: error instanceof FileApiError ? error : createFileApiError({ status: 503 }),
      fileId: stored.fileId,
      status: "retryable_error",
    };
  }

  if (
    session.status === "completed" ||
    session.status === "aborted" ||
    session.status === "expired" ||
    session.status === "failed"
  ) {
    await removeFileUploadSession(fileId);
    return {
      error: null,
      fileId: stored.fileId,
      status: session.status === "completed" ? "completed" : "removed_terminal",
    };
  }

  try {
    await runUploadSession(session, stored.file);
    return {
      error: null,
      fileId: stored.fileId,
      status: "completed",
    };
  } catch (error) {
    const normalized =
      error instanceof FileApiError
        ? error
        : createFileApiError({ message: "Upload resume failed.", status: 503 });

    if (isTerminalFileApiError(normalized)) {
      await removeFileUploadSession(fileId);
      return {
        error: normalized,
        fileId: stored.fileId,
        status: "removed_terminal",
      };
    }

    return {
      error: normalized,
      fileId: stored.fileId,
      status: "retryable_error",
    };
  }
}
