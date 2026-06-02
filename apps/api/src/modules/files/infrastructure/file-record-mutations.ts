import type { FileScopeKind, FileStatus, FileUploadStatus } from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import type { FileId, PlatformId, UploadId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { createUploadExpiredError } from "./file-errors";
import type { FilePathLookupRequest, FileUploadContext } from "./file-record-model";

export async function deleteFileControlRows(
  database: D1Database,
  input: { fileIds: readonly FileId[]; uploadIds?: readonly UploadId[] | undefined },
): Promise<void> {
  const uploadIds = input.uploadIds ? [...new Set(input.uploadIds)] : [];
  const fileIds = [...new Set(input.fileIds)];

  if (uploadIds.length > 0) {
    await getAppDatabase(database)
      .delete(fileUploadsTable)
      .where(inArray(fileUploadsTable.id, uploadIds))
      .run();
  }

  if (fileIds.length === 0) {
    return;
  }

  await getAppDatabase(database)
    .delete(fileUploadsTable)
    .where(inArray(fileUploadsTable.fileId, fileIds))
    .run();
  await getAppDatabase(database)
    .delete(fileRecordsTable)
    .where(inArray(fileRecordsTable.id, fileIds))
    .run();
}

export async function deleteFileControlRowsForScope(
  database: D1Database,
  input: { scopeId: PlatformId; scopeKind: FileScopeKind },
): Promise<void> {
  await getAppDatabase(database)
    .delete(fileUploadsTable)
    .where(
      and(
        eq(fileUploadsTable.scopeKind, input.scopeKind),
        eq(fileUploadsTable.scopeId, input.scopeId),
      ),
    )
    .run();
  await getAppDatabase(database)
    .delete(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, input.scopeKind),
        eq(fileRecordsTable.scopeId, input.scopeId),
      ),
    )
    .run();
}

export async function updateFileUploadStatus(
  database: D1Database,
  input: { status: FileUploadStatus; timestampMs?: number | undefined; uploadId: UploadId },
): Promise<void> {
  await getAppDatabase(database)
    .update(fileUploadsTable)
    .set({
      status: input.status,
      updatedAt: input.timestampMs ?? currentTimestampMs(),
    })
    .where(eq(fileUploadsTable.id, input.uploadId))
    .run();
}

export async function updateFileRecordStatus(
  database: D1Database,
  input: { fileId: FileId; status: FileStatus; timestampMs?: number | undefined },
): Promise<void> {
  await getAppDatabase(database)
    .update(fileRecordsTable)
    .set({
      status: input.status,
      updatedAt: input.timestampMs ?? currentTimestampMs(),
    })
    .where(eq(fileRecordsTable.id, input.fileId))
    .run();
}

export async function markFileRecordsDeleting(
  database: D1Database,
  input: { fileIds: readonly FileId[]; timestampMs?: number | undefined },
): Promise<void> {
  const fileIds = [...new Set(input.fileIds)];

  if (fileIds.length === 0) {
    return;
  }

  await getAppDatabase(database)
    .update(fileRecordsTable)
    .set({
      status: "deleting",
      updatedAt: input.timestampMs ?? currentTimestampMs(),
    })
    .where(inArray(fileRecordsTable.id, fileIds))
    .run();
}

function isUploadExpired(upload: FileUploadContext["upload"]): boolean {
  return upload.status === "expired" || upload.expires_at <= currentTimestampMs();
}

async function markUploadExpired(database: D1Database, context: FileUploadContext): Promise<void> {
  const timestampMs = currentTimestampMs();

  if (
    context.upload.status === "pending" ||
    context.upload.status === "uploading" ||
    context.upload.status === "completing"
  ) {
    await updateFileUploadStatus(database, {
      status: "expired",
      timestampMs,
      uploadId: context.upload.id,
    });
    await updateFileRecordStatus(database, {
      fileId: context.file.id,
      status: "failed",
      timestampMs,
    });
  }
}

export async function expireUploadIfNeeded(
  database: D1Database,
  context: FileUploadContext,
): Promise<void> {
  if (!isUploadExpired(context.upload)) {
    return;
  }

  await markUploadExpired(database, context);
  throw createUploadExpiredError();
}

export async function expirePathLocks({
  database,
  path,
  scopeId,
  scopeKind,
}: FilePathLookupRequest): Promise<void> {
  const now = currentTimestampMs();
  const results = await getAppDatabase(database)
    .select({
      fileId: fileUploadsTable.fileId,
      uploadId: fileUploadsTable.id,
    })
    .from(fileUploadsTable)
    .innerJoin(fileRecordsTable, eq(fileRecordsTable.id, fileUploadsTable.fileId))
    .where(
      and(
        eq(fileUploadsTable.scopeKind, scopeKind),
        eq(fileUploadsTable.scopeId, scopeId),
        eq(fileRecordsTable.path, path),
        inArray(fileUploadsTable.status, ["pending", "uploading", "completing"]),
        sql`${fileUploadsTable.expiresAt} <= ${now}`,
      ),
    )
    .all();

  if (results.length === 0) {
    return;
  }

  await getAppDatabase(database)
    .update(fileUploadsTable)
    .set({
      status: "expired",
      updatedAt: now,
    })
    .where(
      inArray(
        fileUploadsTable.id,
        results.map((row) => row.uploadId),
      ),
    )
    .run();
  await getAppDatabase(database)
    .update(fileRecordsTable)
    .set({
      status: "failed",
      updatedAt: now,
    })
    .where(
      inArray(
        fileRecordsTable.id,
        results.map((row) => row.fileId),
      ),
    )
    .run();
}

export async function markUploadFailed(
  database: D1Database,
  context: FileUploadContext,
): Promise<void> {
  const timestampMs = currentTimestampMs();

  await updateFileUploadStatus(database, {
    status: "failed",
    timestampMs,
    uploadId: context.upload.id,
  });
  await updateFileRecordStatus(database, {
    fileId: context.file.id,
    status: "failed",
    timestampMs,
  });
}
