import {
  createAccountAvatarPath as createContractAccountAvatarPath,
  createAttachmentPath as createContractAttachmentPath,
  createFileObjectKey as createContractFileObjectKey,
  createFileRecordObjectKey,
  createScope as createContractScope,
  createSessionArtifactPath as createContractSessionArtifactPath,
  ensureLibraryFilePathHasExtension as ensureContractLibraryFilePathHasExtension,
  normalizeFileName as normalizeContractFileName,
  normalizeLibraryDirectoryPath as normalizeContractLibraryDirectoryPath,
  normalizeLibraryFilePath as normalizeContractLibraryFilePath,
} from "@mosoo/contracts/file";
import type { FileRecord, FileScopeKind, FileSessionKind } from "@mosoo/contracts/file";
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
  scope_id: PlatformId | null;
  scope_kind: FileScopeKind;
  session_kind?: FileSessionKind | null;
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

export function createAccountAvatarPath(fileId: FileId, fileName: string): string {
  return translatePathAdmission(() => createContractAccountAvatarPath(fileId, fileName));
}

export function createSessionArtifactPath(fileId: FileId, fileName: string): string {
  return translatePathAdmission(() => createContractSessionArtifactPath(fileId, fileName));
}

export function normalizeFileName(name: string): string {
  return translatePathAdmission(() => normalizeContractFileName(name));
}

export function normalizeLibraryDirectoryPath(path?: string | null): string {
  return translatePathAdmission(() => normalizeContractLibraryDirectoryPath(path));
}

export function normalizeLibraryFilePath(path: string): string {
  return translatePathAdmission(() => normalizeContractLibraryFilePath(path));
}

export function ensureLibraryFilePathHasExtension(path: string): string {
  return translatePathAdmission(() => ensureContractLibraryFilePathHasExtension(path));
}

export function createStagingObjectKey(
  scopeKind: FileScopeKind,
  scopeId: FileScopeId,
  fileId: FileId,
): string {
  return `staging/${scopeKind}/${scopeId ?? "unscoped"}/${fileId}`;
}

export function createFinalObjectKey(file: ObjectKeyRecord | FileRecord): string {
  return translatePathAdmission(() => {
    if ("scope_id" in file) {
      return createContractFileObjectKey({
        id: file.id,
        name: file.name,
        path: file.path,
        scope: createContractScope(file.scope_kind, file.scope_id as FileScopeId),
        sessionKind: file.session_kind ?? null,
      });
    }

    return createFileRecordObjectKey(file);
  });
}
