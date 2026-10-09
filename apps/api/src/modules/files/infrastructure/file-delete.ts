import type { FileScopeId, FileScopeKind } from "@mosoo/contracts/file";
import { ignorePromiseRejection } from "@mosoo/effects";
import type { FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFileConflictError } from "./file-errors";
import { ensureFileAccess } from "./file-record-access";
import type { FileCleanupRow, FileRecordRow } from "./file-record-model";
import {
  deleteFileControlRows,
  deleteFileControlRowsForScope,
  markFileRecordsDeleting,
} from "./file-record-mutations";
import { listFilesForScopeCleanup } from "./file-record-queries";

type DeletableFileRow = FileRecordRow &
  Partial<Pick<FileCleanupRow, "multipartUploadId" | "strategy">>;

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

  await bindings.FILE_BUCKET.resumeMultipartUpload(row.object_key, row.multipartUploadId)
    .abort()
    .catch(ignorePromiseRejection);
}

async function deleteFileRows(
  bindings: ApiBindings,
  rows: readonly DeletableFileRow[],
): Promise<void> {
  for (const row of rows) {
    await abortPendingMultipartUpload(bindings, row);
    await markFileRecordsDeleting(bindings.DB, { fileIds: [row.id] });
    await bindings.FILE_BUCKET.delete(row.object_key);
  }
}

export async function deleteAccessibleFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
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

  await deleteFileRows(bindings, [file]);
  await deleteFileControlRows(bindings.DB, { fileIds: [fileId] });
}

export async function deleteFileScope(
  bindings: ApiBindings,
  input: {
    scopeId: FileScopeId;
    scopeKind: FileScopeKind;
  },
): Promise<void> {
  const rows = await listFilesForScopeCleanup(bindings.DB, input);

  await deleteFileRows(bindings, rows);
  await deleteFileControlRowsForScope(bindings.DB, input);
}
