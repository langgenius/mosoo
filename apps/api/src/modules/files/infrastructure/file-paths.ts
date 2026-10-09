import {
  createAccountAvatarPath as createContractAccountAvatarPath,
  createAttachmentPath as createContractAttachmentPath,
  createFileObjectKey as createContractFileObjectKey,
  createScope as createContractScope,
  createSessionArtifactPath as createContractSessionArtifactPath,
  normalizeFileName as normalizeContractFileName,
} from "@mosoo/contracts/file";
import type { FileScopeKind, FileSessionKind } from "@mosoo/contracts/file";
import type { FileScopeId } from "@mosoo/contracts/file";
import type { FileId, PlatformId } from "@mosoo/id";

import { createFileInvalidRequestError } from "./file-errors";

export {
  choosePartSize,
  chooseUploadStrategy,
  createDownloadDisposition,
  createScope,
  normalizeContentType,
} from "@mosoo/contracts/file";

interface ObjectKeyRecord {
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

export function createStagingObjectKey(
  scopeKind: FileScopeKind,
  scopeId: FileScopeId,
  fileId: FileId,
): string {
  return `staging/${scopeKind}/${scopeId ?? "unscoped"}/${fileId}`;
}

export function createFinalObjectKey(file: ObjectKeyRecord): string {
  return translatePathAdmission(() =>
    createContractFileObjectKey({
      id: file.id,
      name: file.name,
      path: file.path,
      scope: createContractScope(file.scope_kind, file.scope_id as FileScopeId),
      sessionKind: file.session_kind ?? null,
    }),
  );
}
