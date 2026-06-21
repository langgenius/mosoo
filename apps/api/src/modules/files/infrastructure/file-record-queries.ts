import type { FileScopeKind, FileSessionKind, FileStatus } from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import type { FileId, PlatformId } from "@mosoo/id";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { FileCleanupRow, FilePathLookupRequest, FileRecordRow } from "./file-record-model";
import { fileRecordRowColumns } from "./file-record-model";

export interface FileRecordListQuery {
  ownerId?: PlatformId;
  scopeId?: PlatformId | null;
  scopeKind?: FileScopeKind;
  sessionKind?: FileSessionKind | null;
  status?: FileStatus;
}

function scopeIdWhere(column: typeof fileRecordsTable.scopeId, scopeId: PlatformId | null) {
  return scopeId === null ? isNull(column) : eq(column, scopeId);
}

export async function getReadyFileByPath({
  database,
  path,
  scopeId,
  scopeKind,
}: FilePathLookupRequest): Promise<FileRecordRow | null> {
  return (
    (await getAppDatabase(database)
      .select(fileRecordRowColumns)
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, scopeKind),
          scopeIdWhere(fileRecordsTable.scopeId, scopeId),
          eq(fileRecordsTable.path, path),
          eq(fileRecordsTable.status, "ready"),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function getPendingFileByPath({
  database,
  path,
  scopeId,
  scopeKind,
}: FilePathLookupRequest): Promise<FileRecordRow | null> {
  return (
    (await getAppDatabase(database)
      .select(fileRecordRowColumns)
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, scopeKind),
          scopeIdWhere(fileRecordsTable.scopeId, scopeId),
          eq(fileRecordsTable.path, path),
          eq(fileRecordsTable.status, "pending"),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

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

export async function listFileRecords(
  database: D1Database,
  input: FileRecordListQuery,
): Promise<FileRecordRow[]> {
  const scopeKind = input.scopeKind ?? "library";
  const scopeId = input.scopeId ?? null;
  const conditions: SQL[] = [
    eq(fileRecordsTable.scopeKind, scopeKind),
    scopeIdWhere(fileRecordsTable.scopeId, scopeId),
    eq(fileRecordsTable.status, input.status ?? "ready"),
  ];

  if (input.sessionKind !== undefined && input.sessionKind !== null) {
    conditions.push(eq(fileRecordsTable.sessionKind, input.sessionKind));
  }

  if (input.ownerId !== undefined) {
    conditions.push(eq(fileRecordsTable.ownerId, input.ownerId));
  }

  return getAppDatabase(database)
    .select(fileRecordRowColumns)
    .from(fileRecordsTable)
    .where(and(...conditions))
    .orderBy(desc(fileRecordsTable.createdAt), desc(fileRecordsTable.id))
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
        scopeIdWhere(fileRecordsTable.scopeId, input.scopeId),
      ),
    )
    .all();
}
