import type { FileScopeId, FileScopeKind } from "@mosoo/contracts/file";
import { ignorePromiseRejection } from "@mosoo/effects";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createFileConflictError,
  createFileDeleteFailedError,
  isRetryableFileControlError,
} from "./file-errors";
import {
  deleteFileControlRows,
  deleteFileControlRowsForScope,
  ensureFileAccess,
  listFilesForScopeCleanup,
  markFileRecordsDeleting,
} from "./file-record-store";
import type { FileCleanupRow, FileRecordRow } from "./file-record-store";
import { getFileScopeDescriptor } from "./file-scope-descriptor";
import { commitPendingFileVersionSafely, createPendingFileVersion } from "./file-version-store";
import type { PendingFileVersion } from "./file-version-store";
import { abortMultipartUpload, deleteObject } from "./r2-s3-client";

type DeletableFileRow = FileRecordRow &
  Partial<Pick<FileCleanupRow, "multipartUploadId" | "strategy" | "uploadId">>;

interface DeleteFileRowsCommand {
  actorAccountId?: AccountId | undefined;
  ifMatchEtag?: string | null | undefined;
  rows: readonly DeletableFileRow[];
  storageFailureMode: "ignore" | "throw";
}

function shouldVersionBeforeDelete(row: DeletableFileRow, actorAccountId?: AccountId): boolean {
  return (
    getFileScopeDescriptor(row.scope_kind).capabilities.versioning &&
    row.status === "ready" &&
    actorAccountId !== undefined &&
    actorAccountId.length > 0
  );
}

async function abortPendingMultipartUpload(
  bindings: ApiBindings,
  row: DeletableFileRow,
): Promise<void> {
  if (
    row.strategy !== "multipart" ||
    row.multipartUploadId === null ||
    row.multipartUploadId === undefined
  ) {
    return;
  }

  await abortMultipartUpload(bindings, row.object_key, row.multipartUploadId).catch(
    ignorePromiseRejection,
  );
}

async function deleteStorageObject(
  bindings: ApiBindings,
  input: {
    ifMatch?: string | undefined;
    objectKey: string;
    storageFailureMode: "ignore" | "throw";
  },
): Promise<void> {
  const deleteOperation = deleteObject(bindings, input.objectKey, {
    ifMatch: input.ifMatch,
  });

  if (input.storageFailureMode === "ignore") {
    await deleteOperation.catch(ignorePromiseRejection);
    return;
  }

  await deleteOperation;
}

async function deleteFileRows(
  bindings: ApiBindings,
  command: DeleteFileRowsCommand,
): Promise<void> {
  for (const row of command.rows) {
    await abortPendingMultipartUpload(bindings, row);

    const actorAccountId = command.actorAccountId;
    const versionBeforeDelete = shouldVersionBeforeDelete(row, actorAccountId);
    let pendingVersion: PendingFileVersion | null = null;

    if (versionBeforeDelete && actorAccountId !== undefined) {
      pendingVersion = await createPendingFileVersion(bindings, row, actorAccountId, "delete");
    }

    await commitPendingFileVersionSafely(bindings, pendingVersion, {
      fileId: row.id,
      objectKey: row.object_key,
      path: row.path,
      reason: "delete",
      scopeId: row.scope_id,
    });
    await markFileRecordsDeleting(bindings.DB, { fileIds: [row.id] });

    const ifMatch =
      row.status === "ready"
        ? (command.ifMatchEtag ??
          (command.storageFailureMode === "throw" || versionBeforeDelete ? row.etag : undefined) ??
          undefined)
        : undefined;

    await deleteStorageObject(bindings, {
      ifMatch,
      objectKey: row.object_key,
      storageFailureMode: versionBeforeDelete ? "throw" : command.storageFailureMode,
    });
  }
}

export async function deleteAccessibleFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  options: { ifMatchEtag?: string | null | undefined } = {},
): Promise<void> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });

  if (file.status !== "ready" && file.status !== "deleting") {
    throw createFileConflictError("Only a ready file can be deleted.");
  }

  try {
    await deleteFileRows(bindings, {
      actorAccountId: parsePlatformId(viewer.id, "viewer ID"),
      ifMatchEtag: options.ifMatchEtag,
      rows: [file],
      storageFailureMode: "throw",
    });
  } catch (error) {
    if (isRetryableFileControlError(error)) {
      throw createFileDeleteFailedError(error.message);
    }

    throw error;
  }

  await deleteFileControlRows(bindings.DB, { fileIds: [fileId] });
}

export async function deleteFileScope(
  bindings: ApiBindings,
  input: {
    actorAccountId?: AccountId | undefined;
    scopeId: FileScopeId;
    scopeKind: FileScopeKind;
  },
): Promise<void> {
  const rows = await listFilesForScopeCleanup(bindings.DB, input);

  await deleteFileRows(bindings, {
    actorAccountId: input.actorAccountId,
    rows,
    storageFailureMode: "throw",
  });
  await deleteFileControlRowsForScope(bindings.DB, input);
}
