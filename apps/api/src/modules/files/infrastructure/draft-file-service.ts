import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, AppId, SessionId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFinalObjectKey } from "./file-paths";
import { listFileRecordsById } from "./file-record-store";
import type { FileRecordRow } from "./file-record-store";
import { copyObject, deleteObject } from "./r2-s3-client";
import { ensureAppSessionFileAccess } from "./session-file-ownership";
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

async function loadClaimableDraftFiles(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  fileIds: readonly FileId[],
): Promise<FileRecordRow[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureAppOwnership(database, viewerId, appId);

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
      file.owner_kind !== "app" ||
      file.owner_id !== appId ||
      file.purpose !== "app_draft" ||
      file.scope_kind !== "app_draft"
    ) {
      throw new Error(`Attachment ${fileId} is not a draft attachment.`);
    }

    if (file.scope_id !== appId) {
      throw new Error(`Attachment ${fileId} does not belong to app ${appId}.`);
    }

    if (file.status !== "ready") {
      throw new Error(`Attachment ${fileId} is not ready.`);
    }

    orderedFiles.push(file);
  }

  return orderedFiles;
}

export async function ensureAppDraftFilesClaimable(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    attachmentIds: FileId[];
    appId: AppId;
  },
): Promise<void> {
  if (input.attachmentIds.length === 0) {
    return;
  }

  await loadClaimableDraftFiles(bindings.DB, viewer, input.appId, input.attachmentIds);
}

export async function claimAppDraftFilesToSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    attachmentIds: FileId[];
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<void> {
  if (input.attachmentIds.length === 0) {
    return;
  }

  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureAppSessionFileAccess(bindings.DB, viewerId, {
    appId: input.appId,
    sessionId: input.sessionId,
  });

  const files = await loadClaimableDraftFiles(
    bindings.DB,
    viewer,
    input.appId,
    input.attachmentIds,
  );
  const claimedFiles: ClaimedDraftFile[] = [];

  try {
    for (const file of files) {
      const nextObjectKey = createFinalObjectKey(toSessionAttachmentRecord(file, input.sessionId));
      const copyOptions = isTruthy(file.etag) ? { sourceIfMatch: file.etag } : {};

      const copied = await copyObject({
        bindings,
        destinationObjectKey: nextObjectKey,
        options: copyOptions,
        sourceObjectKey: file.object_key,
      });

      claimedFiles.push({
        etag: copied.etag,
        file,
        nextObjectKey,
      });
    }

    const timestampMs = currentTimestampMs();
    await runAppDatabaseBatch(bindings.DB, (database) => {
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
              eq(fileRecordsTable.scopeId, input.appId),
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
              eq(fileUploadsTable.scopeId, input.appId),
            ),
          ),
      ]);
      const firstQuery = updateQueries[0];

      if (firstQuery === undefined) {
        throw new Error("Expected at least one draft claim update.");
      }

      return [firstQuery, ...updateQueries.slice(1)];
    });
  } catch (error) {
    await Promise.all(
      claimedFiles.map(async ({ nextObjectKey }) =>
        deleteObject(bindings, nextObjectKey).catch((cleanupError: unknown) => {
          logError("file.draft-claim.cleanup.failed", {
            ...createErrorLogContext(cleanupError),
            nextObjectKey,
            appId: input.appId,
            sessionId: input.sessionId,
          });
        }),
      ),
    );

    throw error;
  }

  await Promise.all(
    claimedFiles.map(async ({ file }) =>
      deleteObject(bindings, file.object_key).catch((error: unknown) => {
        logError("file.draft-claim.source-delete.failed", {
          ...createErrorLogContext(error),
          fileId: file.id,
          objectKey: file.object_key,
          appId: input.appId,
          sessionId: input.sessionId,
        });
      }),
    ),
  );
}
