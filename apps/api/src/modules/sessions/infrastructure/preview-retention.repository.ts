import {
  fileRecordsTable,
  fileUploadsTable,
  sessionExecutionSnapshotsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, createApiError } from "../../../platform/errors";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../runtime/domain/session-run-lifecycle.machine";
import { PREVIEW_RETENTION_MS } from "../domain/preview-retention-policy";

/** Always correlated to the outer Session, including inside atomic admission/cleanup. */
function previewEnrollmentPredicate(db: AppDatabase) {
  return and(
    eq(sessionsTable.type, "preview"),
    // Explicit enrollment protects historical data and non-Cloud creation paths.
    exists(
      db
        .select({ id: sessionExecutionSnapshotsTable.sessionId })
        .from(sessionExecutionSnapshotsTable)
        .where(
          and(
            eq(sessionExecutionSnapshotsTable.sessionId, sessionsTable.id),
            sql`json_extract(${sessionExecutionSnapshotsTable.planJson}, '$.previewRetentionMs') = ${PREVIEW_RETENTION_MS}`,
          ),
        ),
    ),
  )!;
}

export function expiredPreviewPredicate(db: AppDatabase, nowMs: number) {
  const inactiveSince = nowMs - PREVIEW_RETENTION_MS;
  return and(
    previewEnrollmentPredicate(db),
    sql`json_extract(${sessionsTable.metadataJson}, '$.public_api') IS NULL`,
    lte(sessionsTable.createdAt, inactiveSince),
    sql`COALESCE(json_extract(${sessionsTable.metadataJson}, '$.preview_last_activity_at'), ${sessionsTable.createdAt}) <= ${inactiveSince}`,
    or(isNull(sessionsTable.lastMessageAt), lte(sessionsTable.lastMessageAt, inactiveSince)),
    notExists(
      db
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(sessionRunsTable.sessionId, sessionsTable.id),
            or(
              // A Preview used by a backend becomes durable work, even under its old label.
              isNotNull(sessionRunsTable.createdByKeyId),
              inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
              gt(sessionRunsTable.createdAt, inactiveSince),
              gt(sessionRunsTable.completedAt, inactiveSince),
            ),
          ),
        ),
    ),
    notExists(
      db
        .select({ id: fileRecordsTable.id })
        .from(fileRecordsTable)
        .where(
          and(
            eq(fileRecordsTable.scopeKind, "session"),
            eq(fileRecordsTable.scopeId, sessionsTable.id),
            eq(fileRecordsTable.status, "pending"),
            gt(fileRecordsTable.expiresAt, nowMs),
          ),
        ),
    ),
    notExists(
      db
        .select({ id: fileUploadsTable.id })
        .from(fileUploadsTable)
        .where(
          and(
            eq(fileUploadsTable.scopeKind, "session"),
            eq(fileUploadsTable.scopeId, sessionsTable.id),
            eq(fileUploadsTable.status, "pending"),
            gt(fileUploadsTable.expiresAt, nowMs),
          ),
        ),
    ),
  )!;
}

export function previewAvailablePredicate(db: AppDatabase, nowMs: number) {
  return not(expiredPreviewPredicate(db, nowMs));
}

export function previewCleanupCandidatePredicate(db: AppDatabase, nowMs: number) {
  return and(
    eq(sessionsTable.status, "IDLE"),
    isNull(sessionsTable.statusOperationId),
    expiredPreviewPredicate(db, nowMs),
  )!;
}

export async function assertPreviewAvailable(
  database: D1Database,
  sessionId: SessionId,
  nowMs: number,
): Promise<void> {
  const db = getAppDatabase(database);
  const expired = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), expiredPreviewPredicate(db, nowMs)))
    .get();
  if (expired) {
    throw createApiError(
      API_ERROR_CODE.sessionPreviewExpired,
      "This debug Preview expired after 30 days without activity. Start a new Preview.",
    );
  }
}

/** Real file mutation activity survives file deletion and ignores maintenance timestamps. */
export function previewActivityMetadata(db: AppDatabase, nowMs: number) {
  return sql<string>`CASE WHEN ${previewEnrollmentPredicate(db)} THEN
    json_set(${sessionsTable.metadataJson}, '$.preview_last_activity_at',
      MAX(COALESCE(json_extract(${sessionsTable.metadataJson}, '$.preview_last_activity_at'), 0), ${nowMs}))
    ELSE ${sessionsTable.metadataJson} END`;
}

export async function admitPreviewFileActivity(
  database: D1Database,
  sessionId: SessionId,
  nowMs: number,
): Promise<void> {
  const db = getAppDatabase(database);
  const result = await db
    .update(sessionsTable)
    .set({ metadataJson: previewActivityMetadata(db, nowMs) })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        isNull(sessionsTable.archivedAt),
        ne(sessionsTable.status, "TERMINATED"),
        previewAvailablePredicate(db, nowMs),
      ),
    )
    .run();
  if (getD1ChangeCount(result) === 0) {
    await assertPreviewAvailable(database, sessionId, nowMs);
    throw createApiError(
      API_ERROR_CODE.validationFailed,
      "Session no longer accepts file changes.",
    );
  }
}
