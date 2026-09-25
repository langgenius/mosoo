import { fileRecordsTable, fileUploadsTable, sessionsTable } from "@mosoo/db";
import { and, eq, exists, isNull, ne, sql } from "drizzle-orm";

import { getD1ChangeCount, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import {
  previewActivityMetadata,
  previewAvailablePredicate,
} from "../../sessions/infrastructure/preview-retention.repository";

function value<T>(input: T, alias: string) {
  return sql<T>`${input}`.as(alias);
}

/** Upload admission and cleanup serialize in D1; no orphan upload row after a lost claim. */
export async function insertAdmittedFileUpload(
  database: D1Database,
  file: typeof fileRecordsTable.$inferInsert,
  upload: typeof fileUploadsTable.$inferInsert,
): Promise<boolean> {
  const results = await runAppDatabaseBatch(database, (db) => [
    db.insert(fileRecordsTable).select(
      db
        .select({
          committed: sql<boolean>`${file.committed ? 1 : 0}`.as("committed"),
          createdAt: value(file.createdAt, "created_at"),
          createdByAccountId: value(file.createdByAccountId, "created_by_account_id"),
          etag: value(file.etag ?? null, "etag"),
          expiresAt: value(file.expiresAt ?? null, "expires_at"),
          id: value(file.id, "id"),
          mimeType: value(file.mimeType ?? null, "mime_type"),
          name: value(file.name, "name"),
          objectKey: value(file.objectKey, "object_key"),
          ownerId: value(file.ownerId, "owner_id"),
          ownerKind: value(file.ownerKind, "owner_kind"),
          parentPath: value(file.parentPath, "parent_path"),
          path: value(file.path, "path"),
          purpose: value(file.purpose, "purpose"),
          scopeId: value(file.scopeId ?? null, "scope_id"),
          scopeKind: value(file.scopeKind, "scope_kind"),
          sessionKind: value(file.sessionKind ?? null, "session_kind"),
          size: value(file.size, "size"),
          status: value(file.status, "status"),
          updatedAt: value(file.updatedAt, "updated_at"),
          version: value(file.version, "version"),
        })
        .from(sql`(SELECT 1)`)
        .where(
          file.scopeKind !== "session"
            ? sql`TRUE`
            : exists(
                db
                  .select({ id: sessionsTable.id })
                  .from(sessionsTable)
                  .where(
                    and(
                      sql`${sessionsTable.id} = ${file.scopeId}`,
                      isNull(sessionsTable.archivedAt),
                      ne(sessionsTable.status, "TERMINATED"),
                      previewAvailablePredicate(db, file.createdAt),
                    ),
                  ),
              ),
        ),
    ),
    db.insert(fileUploadsTable).select(
      db
        .select({
          contentType: value(upload.contentType ?? null, "content_type"),
          createdAt: value(upload.createdAt, "created_at"),
          createdByAccountId: value(upload.createdByAccountId, "created_by_account_id"),
          expectedSize: value(upload.expectedSize, "expected_size"),
          expiresAt: value(upload.expiresAt, "expires_at"),
          fileId: fileRecordsTable.id,
          id: value(upload.id, "id"),
          ifMatchEtag: value(upload.ifMatchEtag ?? null, "if_match_etag"),
          multipartUploadId: value(upload.multipartUploadId ?? null, "multipart_upload_id"),
          overwrite: sql<boolean>`${upload.overwrite ? 1 : 0}`.as("overwrite"),
          partSize: value(upload.partSize ?? null, "part_size"),
          scopeId: value(upload.scopeId ?? null, "scope_id"),
          scopeKind: value(upload.scopeKind, "scope_kind"),
          status: value(upload.status, "status"),
          strategy: value(upload.strategy, "strategy"),
          updatedAt: value(upload.updatedAt, "updated_at"),
        })
        .from(fileRecordsTable)
        .where(eq(fileRecordsTable.id, file.id)),
    ),
    ...(file.scopeKind !== "session"
      ? []
      : [
          db
            .update(sessionsTable)
            .set({ metadataJson: previewActivityMetadata(db, file.createdAt) })
            .where(
              and(
                sql`${sessionsTable.id} = ${file.scopeId}`,
                exists(
                  db
                    .select({ id: fileUploadsTable.id })
                    .from(fileUploadsTable)
                    .where(eq(fileUploadsTable.id, upload.id)),
                ),
              ),
            ),
        ]),
  ]);
  return getD1ChangeCount(results[0]) > 0;
}
