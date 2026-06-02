import { getSpaceFileNameExtensionError } from "@mosoo/contracts/file";

import { FileApiError } from "@/shared/lib/file-api-error";

export function getFileNameValidationError(name: string): string | null {
  const trimmedName = name.trim();
  return trimmedName ? getSpaceFileNameExtensionError(trimmedName) : null;
}

export function getErrorMessage(error: unknown, defaultMessage: string): string {
  return error instanceof Error ? error.message : defaultMessage;
}

export type UploadRowStatus = "done" | "failed" | "skipped" | "uploading" | "waiting";

export interface UploadRow {
  error?: string | undefined;
  file: File;
  id: string;
  name: string;
  parentPath?: string | undefined;
  path: string;
  status: UploadRowStatus;
}

export interface PendingUploadConflict {
  currentEtag?: string | undefined;
  failedFile: File;
  failedFileName: string;
  message: string;
  parentPath?: string | undefined;
  remainingFiles: File[];
}

function getDisplayUploadPath(file: File, parentPath?: string): string {
  const rawRelativePath =
    "webkitRelativePath" in file ? Reflect.get(file, "webkitRelativePath") : null;
  const relativePath =
    typeof rawRelativePath === "string" && rawRelativePath.length > 0 ? rawRelativePath : file.name;
  const trimmedParent = (parentPath ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmedParent ? `${trimmedParent}/${relativePath}` : relativePath;
}

export function createUploadRow(file: File, index: number, parentPath?: string): UploadRow {
  return {
    file,
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    name: file.name,
    parentPath,
    path: getDisplayUploadPath(file, parentPath),
    status: "waiting",
  };
}

export function readCurrentEtag(error: unknown): string | undefined {
  if (!(error instanceof FileApiError)) {
    return undefined;
  }

  const value = error.details["currentEtag"];
  return typeof value === "string" && value.trim() ? value : undefined;
}
