import type { FileRecord } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { FileControlError } from "./file-errors";
import {
  deleteFileControlRows,
  getFileRecordById,
  getReadyFileByPath,
  toFileRecord,
  updateFileUploadStatus,
} from "./file-record-store";
import type { FileUploadContext } from "./file-record-store";
import type { HeadObjectResult } from "./r2-s3-client";

export interface FinalizeReadyFileRecordInput {
  bindings: ApiBindings;
  context: FileUploadContext;
  finalHead: HeadObjectResult;
  finalObjectKey: string;
}

function getReadyFileExpiresAt(context: FileUploadContext): number | null {
  return context.file.purpose === "agent_package" || context.file.purpose === "organization_draft"
    ? context.file.expires_at
    : null;
}

export async function finalizeReadyFileRecord(
  input: FinalizeReadyFileRecordInput,
): Promise<FileRecord> {
  const { bindings, context, finalHead, finalObjectKey } = input;
  const existingReady = await getReadyFileByPath({
    database: bindings.DB,
    path: context.file.path,
    scopeId: context.file.scope_id,
    scopeKind: context.file.scope_kind,
  });
  const timestampMs = currentTimestampMs();
  const nextVersion = existingReady ? existingReady.version + 1 : context.file.version;

  if (existingReady && existingReady.id !== context.file.id) {
    await deleteFileControlRows(bindings.DB, { fileIds: [existingReady.id] });
  }

  await getAppDatabase(bindings.DB)
    .update(fileRecordsTable)
    .set({
      committed:
        context.file.scope_kind === "session" ||
        context.file.scope_kind === "organization_avatar" ||
        context.file.committed === 1,
      etag: finalHead.etag,
      expiresAt: getReadyFileExpiresAt(context),
      mimeType: finalHead.contentType,
      objectKey: finalObjectKey,
      size: finalHead.contentLength,
      status: "ready",
      updatedAt: timestampMs,
      version: nextVersion,
    })
    .where(eq(fileRecordsTable.id, context.file.id))
    .run();

  await updateFileUploadStatus(bindings.DB, {
    status: "completed",
    timestampMs,
    uploadId: context.upload.id,
  });

  const updated = await getFileRecordById(bindings.DB, context.file.id);

  if (!updated) {
    throw new FileControlError(
      503,
      "file_storage_unavailable",
      "File record disappeared during finalize.",
      true,
    );
  }

  return toFileRecord(updated);
}
