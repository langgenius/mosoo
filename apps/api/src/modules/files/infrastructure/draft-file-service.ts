import { fileRecordsTable, fileUploadsTable, sessionsTable } from "@mosoo/db";
import type { AccountId, FileId, ProjectId, SessionId } from "@mosoo/id";
import { and, eq, exists, isNull, ne, sql } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getD1ChangeCount, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { createFileConflictError } from "./file-errors";
import { createFinalObjectKey } from "./file-paths";
import type { FileRecordRow } from "./file-record-model";
import { listFileRecordsById } from "./file-record-queries";
import { copyR2Object } from "./r2-object";

interface ClaimedDraftFile {
  etag: string;
  file: FileRecordRow;
  nextObjectKey: string;
}

function toSessionAttachmentRecord(file: FileRecordRow, sessionId: SessionId): FileRecordRow {
  return {
    ...file,
    committed: 1,
    expires_at: null,
    owner_id: sessionId,
    owner_kind: "session",
    purpose: "session_attachment",
    scope_id: sessionId,
    scope_kind: "session",
    session_kind: "attachment",
  };
}

/** The caller has already authorized the viewer for the owning Project and target Session. */
export async function loadClaimableDraftFiles(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
  fileIds: readonly FileId[],
  sessionId?: SessionId,
): Promise<FileRecordRow[]> {
  const files = await listFileRecordsById(database, fileIds);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const orderedFiles: FileRecordRow[] = [];

  for (const fileId of fileIds) {
    const file = filesById.get(fileId);

    if (!file) {
      throw new Error(`Attachment ${fileId} was not found.`);
    }

    if (file.created_by_account_id !== viewerId) {
      throw new Error(`Attachment ${fileId} was not found.`);
    }

    if (
      sessionId !== undefined &&
      file.owner_kind === "session" &&
      file.owner_id === sessionId &&
      file.scope_kind === "session" &&
      file.scope_id === sessionId &&
      file.purpose === "session_attachment" &&
      file.session_kind === "attachment" &&
      file.status === "ready" &&
      file.committed === 1
    ) {
      // Claim retries retain the same file ID and bytes in the same Session.
      continue;
    }

    if (
      file.owner_kind !== "app" ||
      file.owner_id !== projectId ||
      file.purpose !== "app_draft" ||
      file.scope_kind !== "app_draft"
    ) {
      throw new Error(`Attachment ${fileId} is not a draft attachment.`);
    }

    if (file.scope_id !== projectId) {
      throw new Error(`Attachment ${fileId} does not belong to project ${projectId}.`);
    }

    if (file.status !== "ready") {
      throw new Error(`Attachment ${fileId} is not ready.`);
    }

    orderedFiles.push(file);
  }

  return orderedFiles;
}

/** The caller has already authorized the viewer for the owning Project and writable Session. */
export async function claimProjectDraftFilesToSession(
  bindings: ApiBindings,
  viewerId: AccountId,
  input: {
    attachmentIds: FileId[];
    projectId: ProjectId;
    sessionId: SessionId;
    resume?: boolean;
  },
): Promise<void> {
  const files = await loadClaimableDraftFiles(
    bindings.DB,
    viewerId,
    input.projectId,
    input.attachmentIds,
    input.resume ? input.sessionId : undefined,
  );
  if (files.length === 0) return;
  const claimedFiles: ClaimedDraftFile[] = [];

  // Preserve copied objects on an ambiguous D1 failure: the transaction may
  // already reference them. Retrying this Session reuses the admitted file IDs.
  for (const file of files) {
    const nextObjectKey = createFinalObjectKey(toSessionAttachmentRecord(file, input.sessionId));
    const copied = await copyR2Object(bindings.FILE_BUCKET, file.object_key, nextObjectKey);

    claimedFiles.push({
      etag: copied.etag,
      file,
      nextObjectKey,
    });
  }

  const timestampMs = currentTimestampMs();
  const results = await runAppDatabaseBatch(bindings.DB, (database) => {
    const writableSession = exists(
      database
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.id, input.sessionId),
            isNull(sessionsTable.archivedAt),
            ne(sessionsTable.status, "TERMINATED"),
          ),
        ),
    );
    const updateQueries = claimedFiles.flatMap(({ etag, file, nextObjectKey }) => [
      database
        .update(fileRecordsTable)
        .set({
          committed: true,
          etag,
          expiresAt: null,
          objectKey: nextObjectKey,
          ownerId: input.sessionId,
          ownerKind: "session" as const,
          purpose: "session_attachment" as const,
          scopeId: input.sessionId,
          scopeKind: "session" as const,
          sessionKind: "attachment" as const,
          updatedAt: timestampMs,
          version: sql`${fileRecordsTable.version} + 1`,
        })
        .where(
          and(
            eq(fileRecordsTable.id, file.id),
            eq(fileRecordsTable.scopeKind, "app_draft"),
            eq(fileRecordsTable.scopeId, input.projectId),
            writableSession,
          ),
        ),
      database
        .update(fileUploadsTable)
        .set({
          scopeId: input.sessionId,
          scopeKind: "session" as const,
          updatedAt: timestampMs,
        })
        .where(
          and(
            eq(fileUploadsTable.fileId, file.id),
            eq(fileUploadsTable.scopeKind, "app_draft"),
            eq(fileUploadsTable.scopeId, input.projectId),
            writableSession,
          ),
        ),
    ]);
    const firstQuery = updateQueries[0];

    if (firstQuery === undefined) {
      throw new Error("Expected at least one draft claim update.");
    }

    return [firstQuery, ...updateQueries.slice(1)];
  });

  if (results.some((result: unknown) => getD1ChangeCount(result) === 0)) {
    throw createFileConflictError("Session or draft file changed before the claim completed.");
  }

  await Promise.all(
    claimedFiles.map(async ({ file }) =>
      bindings.FILE_BUCKET.delete(file.object_key).catch((error: unknown) => {
        logError("file.draft-claim.source-delete.failed", {
          ...createErrorLogContext(error),
          fileId: file.id,
          objectKey: file.object_key,
          projectId: input.projectId,
          sessionId: input.sessionId,
        });
      }),
    ),
  );
}
