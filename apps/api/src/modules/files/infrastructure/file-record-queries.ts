import type { FileScopeKind } from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import type { FileId, PlatformId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { FileCleanupRow, FileRecordRow } from "./file-record-model";
import { fileRecordRowColumns } from "./file-record-model";

export async function getFileRecordById(
  database: D1Database,
  fileId: FileId,
): Promise<FileRecordRow | null> {
  return (
    (await getAppDatabase(database)
      .select(fileRecordRowColumns)
      .from(fileRecordsTable)
      .where(eq(fileRecordsTable.id, fileId))
      .limit(1)
      .get()) ?? null
  );
}

export async function listFileRecordsById(
  database: D1Database,
  fileIds: readonly FileId[],
): Promise<FileRecordRow[]> {
  const uniqueFileIds = [...new Set(fileIds)];

  if (uniqueFileIds.length === 0) {
    return [];
  }

  return getAppDatabase(database)
    .select(fileRecordRowColumns)
    .from(fileRecordsTable)
    .where(inArray(fileRecordsTable.id, uniqueFileIds))
    .all();
}

export async function listFilesForScopeCleanup(
  database: D1Database,
  input: { scopeId: PlatformId | null; scopeKind: FileScopeKind },
): Promise<FileCleanupRow[]> {
  return getAppDatabase(database)
    .select({
      ...fileRecordRowColumns,
      multipartUploadId: fileUploadsTable.multipartUploadId,
      strategy: fileUploadsTable.strategy,
      uploadId: sql`${fileUploadsTable.id}`.mapWith(fileUploadsTable.id).as("uploadId"),
    })
    .from(fileRecordsTable)
    .leftJoin(fileUploadsTable, eq(fileUploadsTable.fileId, fileRecordsTable.id))
    .where(
      and(
        eq(fileRecordsTable.scopeKind, input.scopeKind),
        input.scopeId === null
          ? isNull(fileRecordsTable.scopeId)
          : eq(fileRecordsTable.scopeId, input.scopeId),
      ),
    )
    .all();
}
