import type {
  CompleteFileUploadPart,
  CompleteFileUploadRequest,
  CompleteFileUploadResponse,
  CreateFileUploadRequest,
  FileEntry,
  FileUploadSummary,
  UploadFilePartResponse,
} from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/id";

import { readFileApiError, requestJson } from "@/platform/http/file-request";
import { apiFetch } from "@/platform/http/public-api";

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
    throw await readFileApiError(response);
  }
}

async function uploadMultipartPart(
  session: FileUploadSummary,
  file: Blob,
  partNumber: number,
  partSize: number,
): Promise<CompleteFileUploadPart> {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, file.size);
  const response = await apiFetch(`/files/${session.fileId}/parts/${partNumber}`, {
    body: file.slice(start, end),
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw await readFileApiError(response);
  }

  const { etag } = (await response.json()) as UploadFilePartResponse;
  return { etag, partNumber };
}

async function uploadMultipartParts(
  session: FileUploadSummary,
  file: Blob,
): Promise<CompleteFileUploadPart[]> {
  if (!session.partSize) {
    throw new Error("Multipart upload is missing a part size.");
  }

  const partSize = session.partSize;
  const totalParts = Math.ceil(file.size / partSize);
  const parts: CompleteFileUploadPart[] = [];
  let nextPartNumber = 1;

  async function uploadNextPart(): Promise<void> {
    const partNumber = nextPartNumber;
    nextPartNumber += 1;

    if (partNumber > totalParts) {
      return;
    }

    parts.push(await uploadMultipartPart(session, file, partNumber, partSize));
    await uploadNextPart();
  }

  await Promise.all(Array.from({ length: Math.min(8, totalParts) }, () => uploadNextPart()));
  return parts.toSorted((left, right) => left.partNumber - right.partNumber);
}

export async function runUploadSession(session: FileUploadSummary, file: Blob): Promise<FileEntry> {
  const body: CompleteFileUploadRequest = {};

  if (session.strategy === "multipart") {
    body.parts = await uploadMultipartParts(session, file);
  } else {
    await uploadSinglePut(session, file);
  }

  const response = await requestJson<CompleteFileUploadResponse>(
    `/files/${session.fileId}/complete`,
    { bodyJson: body, method: "POST" },
  );
  return response.file;
}

export async function createAndRunFileUpload(
  input: CreateFileUploadRequest,
  file: File,
): Promise<{ fileId: FileId }> {
  const session = await requestJson<FileUploadSummary>("/files", {
    bodyJson: input,
    method: "POST",
  });

  await runUploadSession(session, file);

  return {
    fileId: session.fileId,
  };
}
