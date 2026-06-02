import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, SessionId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFinalObjectKey } from "./file-paths";
import { listFileRecordsById } from "./file-record-store";
import type { FileRecordRow } from "./file-record-store";
import { ensureOrganizationMembership } from "./organization-file-access";
import { copyObject, deleteObject } from "./r2-s3-client";
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
  organizationId: OrganizationId,
  fileIds: readonly FileId[],
): Promise<FileRecordRow[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureOrganizationMembership(database, viewerId, organizationId);

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

    if (file.scope_kind !== "organization_draft") {
      throw new Error(`Attachment ${fileId} is not a draft attachment.`);
    }

    if (file.scope_id !== organizationId) {
      throw new Error(`Attachment ${fileId} does not belong to organization ${organizationId}.`);
    }

    if (file.status !== "ready") {
      throw new Error(`Attachment ${fileId} is not ready.`);
    }

    orderedFiles.push(file);
  }

  return orderedFiles;
}

export async function ensureOrganizationDraftFilesClaimable(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    attachmentIds: FileId[];
    organizationId: OrganizationId;
  },
): Promise<void> {
  if (input.attachmentIds.length === 0) {
    return;
  }

  await loadClaimableDraftFiles(bindings.DB, viewer, input.organizationId, input.attachmentIds);
}

export async function claimOrganizationDraftFilesToSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    attachmentIds: FileId[];
    sessionId: SessionId;
    organizationId: OrganizationId;
  },
): Promise<void> {
  if (input.attachmentIds.length === 0) {
    return;
  }

  const files = await loadClaimableDraftFiles(
    bindings.DB,
    viewer,
    input.organizationId,
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
          .where(eq(fileRecordsTable.id, file.id)),
        database
          .update(fileUploadsTable)
          .set({
            scopeId: input.sessionId,
            scopeKind: "session" as const,
            updatedAt: timestampMs,
          })
          .where(eq(fileUploadsTable.fileId, file.id)),
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
            organizationId: input.organizationId,
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
          organizationId: input.organizationId,
          sessionId: input.sessionId,
        });
      }),
    ),
  );
}
