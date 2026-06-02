import type {
  CompleteFileUploadRequest,
  CompleteFileUploadResponse,
  CreateFileUploadRequest,
  FileRecord,
  FileUploadSummary,
  UploadFilePartResponse,
} from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/contracts/id";

import { requestJson } from "@/platform/http/file-request";
import { apiFetch } from "@/platform/http/public-api";
import { createFileApiError, parseFileApiError } from "@/shared/lib/file-api-error";

import { isTruthy } from "../../../shared/lib/truthiness";
import {
  appendUploadedPart,
  getFileUploadSession,
  removeFileUploadSession,
  saveFileUploadSession,
} from "../file-upload.store";
import type { StoredFileUploadSession } from "../file-upload.store";
import { dispatchUploadCompleted } from "./file-upload-events";
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseUploadFilePartResponse(value: unknown, partNumber: number): UploadFilePartResponse {
  if (
    !isRecord(value) ||
    typeof value["etag"] !== "string" ||
    value["etag"].length === 0 ||
    value["partNumber"] !== partNumber
  ) {
    throw createFileApiError({
      code: "file_upload_invalid_part",
      message: `Multipart upload part ${partNumber} returned an invalid response.`,
      retryable: false,
      status: 400,
    });
  }

  return {
    etag: value["etag"],
    partNumber,
  };
}

async function uploadSinglePut(session: FileUploadSummary, file: Blob): Promise<void> {
  const response = await apiFetch(`/files/${session.fileId}/content`, {
    body: file,
    credentials: "include",
    headers: {
      "Content-Type": session.contentType,
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw await parseFileApiError(response);
  }
}

async function uploadMultipartParts(session: FileUploadSummary, file: Blob): Promise<void> {
  if (!isTruthy(session.partSize)) {
    throw createFileApiError({
      code: "file_upload_invalid_state",
      message: "Multipart upload is missing a part size.",
      retryable: false,
      status: 409,
    });
  }

  const stored = await getFileUploadSession(session.fileId);
  const uploadedPartNumbers = new Set((stored?.parts ?? []).map((part) => part.partNumber));
  const totalParts = Math.ceil(file.size / session.partSize);

  for (let batchStart = 1; batchStart <= totalParts; batchStart += 8) {
    const batchNumbers = Array.from(
      { length: Math.min(8, totalParts - batchStart + 1) },
      (_unused, index) => batchStart + index,
    ).filter((partNumber) => !uploadedPartNumbers.has(partNumber));

    if (batchNumbers.length === 0) {
      continue;
    }

    await Promise.all(
      batchNumbers.map(async (partNumber) => {
        const start = (partNumber - 1) * session.partSize!;
        const end = Math.min(start + session.partSize!, file.size);
        const response = await apiFetch(`/files/${session.fileId}/parts/${partNumber}`, {
          body: file.slice(start, end),
          credentials: "include",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          method: "PUT",
        });

        if (!response.ok) {
          throw await parseFileApiError(response);
        }

        const payload = parseUploadFilePartResponse(await response.json(), partNumber);

        uploadedPartNumbers.add(payload.partNumber);
        await appendUploadedPart(session.fileId, {
          etag: payload.etag,
          partNumber: payload.partNumber,
        });
      }),
    );
  }
}

async function completeUpload(session: FileUploadSummary): Promise<FileRecord> {
  const stored = await getFileUploadSession(session.fileId);
  const bodyJson: CompleteFileUploadRequest =
    session.strategy === "multipart"
      ? {
          parts: (stored?.parts ?? []).map((part) => ({
            etag: part.etag,
            partNumber: part.partNumber,
          })),
        }
      : {};
  const response = await requestJson<CompleteFileUploadResponse, CompleteFileUploadRequest>(
    `/files/${session.fileId}/complete`,
    {
      bodyJson,
      method: "POST",
    },
  );

  return response.file;
}

async function persistUploadSession(
  session: FileUploadSummary,
  file: File,
): Promise<StoredFileUploadSession> {
  const record: StoredFileUploadSession = {
    contentType: session.contentType,
    expectedSize: session.expectedSize,
    expiresAt: session.expiresAt,
    file,
    fileId: session.fileId,
    fileName: file.name,
    partSize: session.partSize,
    parts: [],
    path: session.path,
    scopeId: session.scope.id,
    scopeKind: session.scope.kind,
    strategy: session.strategy,
  };

  await saveFileUploadSession(record);
  return record;
}

export async function runUploadSession(
  session: FileUploadSummary,
  file: Blob,
): Promise<FileRecord> {
  if (session.strategy === "single_put" && session.status !== "completing") {
    await uploadSinglePut(session, file);
  } else if (session.strategy === "multipart" && session.status !== "completing") {
    await uploadMultipartParts(session, file);
  }

  const finalizedFile = await completeUpload(session);
  await removeFileUploadSession(session.fileId);
  dispatchUploadCompleted({
    fileId: finalizedFile.id,
    scopeId: session.scope.id,
    scopeKind: session.scope.kind,
  });
  return finalizedFile;
}

export async function createAndRunFileUpload(
  input: CreateFileUploadRequest,
  file: File,
): Promise<{ fileId: FileId }> {
  const session = await requestJson<FileUploadSummary, CreateFileUploadRequest>("/files", {
    bodyJson: input,
    method: "POST",
  });

  await persistUploadSession(session, file);
  await runUploadSession(session, file);

  return {
    fileId: session.fileId,
  };
}
