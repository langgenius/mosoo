import type { FileRecord } from "@mosoo/contracts/file";
import type { FileId, SpaceId } from "@mosoo/contracts/id";

import { requestJson } from "@/platform/http/file-request";
import { createFileApiError, FileApiError } from "@/shared/lib/file-api-error";
import type { FileUploadBatchResult } from "@/shared/lib/file-api-error";

import { isTruthy } from "../../../shared/lib/truthiness";
import { createAndRunFileUpload } from "./file-upload-client";
function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinUploadPath(parentPath: string | undefined, childPath: string): string {
  const normalizedChild = trimSlashes(childPath.trim());

  if (!normalizedChild) {
    throw createFileApiError({
      code: "file_invalid_request",
      message: "File path is required.",
      retryable: false,
      status: 400,
    });
  }

  const normalizedParent = trimSlashes(parentPath?.trim() ?? "");
  return normalizedParent ? `${normalizedParent}/${normalizedChild}` : normalizedChild;
}

function getUploadRelativePath(file: File): string | null {
  if (!("webkitRelativePath" in file)) {
    return null;
  }

  const relativePath = Reflect.get(file, "webkitRelativePath");
  return typeof relativePath === "string" && relativePath.length > 0 ? relativePath : null;
}

type UploadConflictMode = "fail" | "keep_both" | "replace";
type UploadFileStatus = "done" | "failed" | "uploading" | "waiting";

interface UploadFileProgress {
  error?: string | undefined;
  file: File;
  index: number;
  path: string;
  status: UploadFileStatus;
  total: number;
}

interface UploadSpaceFilesOptions {
  conflictMode?: UploadConflictMode | undefined;
  onFileProgress?: (progress: UploadFileProgress) => void;
  replaceIfMatchEtag?: string | undefined;
}

function createCopyPath(path: string, copyNumber: number): string {
  const slashIndex = path.lastIndexOf("/");
  const parent = slashIndex === -1 ? "" : `${path.slice(0, slashIndex + 1)}`;
  const name = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  const dotIndex = name.lastIndexOf(".");
  const suffix = copyNumber === 1 ? " copy" : ` copy ${copyNumber}`;

  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return `${parent}${name}${suffix}`;
  }

  return `${parent}${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`;
}

async function uploadOneSpaceFile(input: {
  conflictMode: UploadConflictMode;
  file: File;
  logicalPath: string;
  replaceIfMatchEtag?: string | undefined;
  spaceId: SpaceId;
}): Promise<{ fileId: FileId }> {
  try {
    const ifMatchEtag =
      input.conflictMode === "replace" && input.replaceIfMatchEtag !== undefined
        ? input.replaceIfMatchEtag
        : undefined;

    return await createAndRunFileUpload(
      {
        file: {
          contentType: input.file.type,
          name: input.file.name,
          size: input.file.size,
        },
        ...(ifMatchEtag === undefined ? {} : { ifMatchEtag }),
        overwrite: input.conflictMode === "replace",
        purpose: "space_file",
        target: {
          id: input.spaceId,
          kind: "space",
          path: input.logicalPath,
        },
      },
      input.file,
    );
  } catch (error) {
    if (
      input.conflictMode !== "keep_both" ||
      !(error instanceof FileApiError) ||
      error.code !== "file_conflict"
    ) {
      throw error;
    }

    for (let copyNumber = 1; copyNumber <= 99; copyNumber += 1) {
      try {
        return await uploadOneSpaceFile({
          ...input,
          conflictMode: "fail",
          logicalPath: createCopyPath(input.logicalPath, copyNumber),
        });
      } catch (retryError) {
        if (!(retryError instanceof FileApiError) || retryError.code !== "file_conflict") {
          throw retryError;
        }
      }
    }

    throw error;
  }
}

export async function uploadSpaceFiles(
  spaceId: SpaceId,
  files: FileList | File[],
  parentPath?: string,
  options: UploadSpaceFilesOptions = {},
): Promise<FileUploadBatchResult> {
  const uploaded: string[] = [];
  const allFiles = [...files];
  const conflictMode = options.conflictMode ?? "fail";

  for (const [index, file] of allFiles.entries()) {
    let logicalPath = file.name;

    try {
      const relativePath = getUploadRelativePath(file);
      logicalPath = isTruthy(relativePath)
        ? joinUploadPath(parentPath, relativePath)
        : joinUploadPath(parentPath, file.name);

      options.onFileProgress?.({
        file,
        index,
        path: logicalPath,
        status: "uploading",
        total: allFiles.length,
      });

      const result = await uploadOneSpaceFile({
        conflictMode,
        file,
        logicalPath,
        replaceIfMatchEtag:
          index === 0 && conflictMode === "replace" ? options.replaceIfMatchEtag : undefined,
        spaceId,
      });

      uploaded.push(result.fileId);
      options.onFileProgress?.({
        file,
        index,
        path: logicalPath,
        status: "done",
        total: allFiles.length,
      });
    } catch (error) {
      const normalized =
        error instanceof FileApiError
          ? error
          : createFileApiError({ message: "Upload failed.", status: 503 });

      options.onFileProgress?.({
        error: normalized.message,
        file,
        index,
        path: logicalPath,
        status: "failed",
        total: allFiles.length,
      });

      return {
        error: normalized,
        failedFile: file,
        failedFileIndex: index,
        failedFileName: file.name,
        failedLogicalPath: logicalPath,
        remainingFiles: allFiles.slice(index + 1),
        skippedCount: allFiles.length - index - 1,
        successCount: uploaded.length,
        uploaded,
      };
    }
  }

  return {
    error: null,
    failedFile: undefined,
    failedFileIndex: undefined,
    failedFileName: null,
    failedLogicalPath: undefined,
    remainingFiles: [],
    skippedCount: 0,
    successCount: uploaded.length,
    uploaded,
  };
}

export async function deleteFileRecordWithPrecondition(
  fileId: FileId,
  ifMatchEtag?: string | null,
): Promise<{ ok: true }> {
  const headers = new Headers();

  if (isTruthy(ifMatchEtag)) {
    headers.set("If-Match", ifMatchEtag);
  }

  return requestJson<{ ok: true }>(`/files/${fileId}`, {
    headers,
    method: "DELETE",
  });
}

export async function renameSpaceFile(
  fileId: FileId,
  path: string,
  ifMatchVersion: number,
  ifMatchEtag?: string | null,
  targetSpaceId?: SpaceId,
): Promise<FileRecord> {
  return requestJson<
    FileRecord,
    {
      ifMatchVersion: number;
      overwrite: boolean;
      path: string;
      targetSpaceId?: string | undefined;
    }
  >(`/files/${fileId}`, {
    bodyJson: {
      ifMatchVersion,
      ...(isTruthy(ifMatchEtag) ? { ifMatchEtag } : {}),
      overwrite: false,
      path,
      targetSpaceId,
    },
    method: "PATCH",
  });
}
