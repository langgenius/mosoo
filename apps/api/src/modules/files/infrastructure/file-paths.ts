import {
  createAttachmentPath as createContractAttachmentPath,
  createFileObjectKey as createContractFileObjectKey,
  createFileRecordObjectKey,
  createScope as createContractScope,
  ensureSpaceFilePathHasExtension as ensureContractSpaceFilePathHasExtension,
  normalizeFileName as normalizeContractFileName,
  normalizeSpaceDirectoryPath as normalizeContractSpaceDirectoryPath,
  normalizeSpaceFilePath as normalizeContractSpaceFilePath,
} from "@mosoo/contracts/file";
import type { FileRecord, FileScopeKind } from "@mosoo/contracts/file";
import type { FileScopeId } from "@mosoo/contracts/file";
import type { AccountId, FileId, PlatformId } from "@mosoo/id";

import { createFileInvalidRequestError } from "./file-errors";

export {
  choosePartSize,
  chooseUploadStrategy,
  createDownloadDisposition,
  createScope,
  normalizeContentType,
} from "@mosoo/contracts/file";

interface ObjectKeyRecord {
  created_by_account_id: AccountId;
  id: FileId;
  name: string;
  path: string;
  scope_id: PlatformId;
  scope_kind: FileScopeKind;
}

function translatePathAdmission<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid file path.";
    throw createFileInvalidRequestError(message);
  }
}

export function createAttachmentPath(fileId: FileId, fileName: string): string {
  return translatePathAdmission(() => createContractAttachmentPath(fileId, fileName));
}

export function normalizeFileName(name: string): string {
  return translatePathAdmission(() => normalizeContractFileName(name));
}

export function normalizeSpaceDirectoryPath(path?: string): string {
  return translatePathAdmission(() => normalizeContractSpaceDirectoryPath(path));
}

export function normalizeSpaceFilePath(path: string): string {
  return translatePathAdmission(() => normalizeContractSpaceFilePath(path));
}

export function ensureSpaceFilePathHasExtension(path: string): string {
  return translatePathAdmission(() => ensureContractSpaceFilePathHasExtension(path));
}

export function createStagingObjectKey(
  scopeKind: FileScopeKind,
  scopeId: FileScopeId,
  fileId: FileId,
): string {
  return `staging/${scopeKind}/${scopeId}/${fileId}`;
}

export function createFinalObjectKey(file: ObjectKeyRecord | FileRecord): string {
  return translatePathAdmission(() => {
    if ("scope_id" in file) {
      return createContractFileObjectKey({
        id: file.id,
        name: file.name,
        path: file.path,
        scope: createContractScope(file.scope_kind, file.scope_id as FileScopeId),
      });
    }

    return createFileRecordObjectKey(file);
  });
}
