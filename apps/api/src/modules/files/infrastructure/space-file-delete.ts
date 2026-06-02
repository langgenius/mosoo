import { spaceDirectoriesTable } from "@mosoo/db";
import { ignorePromiseRejection } from "@mosoo/effects";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";
import { and, eq, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteFileById } from "./file-content-service";
import { normalizeSpaceDirectoryPath } from "./file-paths";
import {
  deleteFileControlRows,
  getReadyFileByPath,
  listSpaceFilesForDirectoryCleanup,
  markFileRecordsDeleting,
} from "./file-record-store";
import { abortMultipartUpload, deleteObject } from "./r2-s3-client";
import { ensureSpaceAccess } from "./space-access";
import { ensureSpaceFileWriteUnlocked } from "./space-file-lock";
import {
  commitPendingSpaceFileVersionSafely,
  createPendingSpaceFileVersion,
} from "./space-file-version-store";

function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);
}

export async function deleteSpaceEntry(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: { key: string; spaceId: SpaceId },
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, input.spaceId, "edit");
  const normalizedKey = normalizeSpaceDirectoryPath(input.key);
  const escapedKey = escapeLikePattern(normalizedKey);

  if (!input.key.endsWith("/")) {
    const file = await getReadyFileByPath({
      database: bindings.DB,
      path: normalizedKey,
      scopeId: input.spaceId,
      scopeKind: "space",
    });

    if (file) {
      await deleteFileById(bindings, viewer, file.id);
      return;
    }
  }

  const descendantFiles = await listSpaceFilesForDirectoryCleanup(bindings.DB, {
    path: normalizedKey,
    pathLike: `${escapedKey}/%`,
    spaceId: input.spaceId,
  });

  for (const fileRecord of descendantFiles) {
    await ensureSpaceFileWriteUnlocked(bindings, viewer, input.spaceId, fileRecord.path);
  }

  for (const fileRecord of descendantFiles) {
    const multipartUploadId = fileRecord.multipartUploadId;

    if (
      fileRecord.strategy === "multipart" &&
      multipartUploadId !== null &&
      multipartUploadId !== undefined
    ) {
      await abortMultipartUpload(bindings, fileRecord.object_key, multipartUploadId).catch(
        ignorePromiseRejection,
      );
    }

    if (fileRecord.status === "ready") {
      const pendingVersion = await createPendingSpaceFileVersion(
        bindings,
        fileRecord,
        viewerId,
        "directory_delete",
      );

      await commitPendingSpaceFileVersionSafely(bindings, pendingVersion, {
        fileId: fileRecord.id,
        objectKey: fileRecord.object_key,
        path: fileRecord.path,
        reason: "directory_delete",
        scopeId: fileRecord.scope_id,
      });
      await markFileRecordsDeleting(bindings.DB, { fileIds: [fileRecord.id] });
      await deleteObject(bindings, fileRecord.object_key, {
        ifMatch: fileRecord.etag ?? undefined,
      });
    } else {
      await markFileRecordsDeleting(bindings.DB, { fileIds: [fileRecord.id] });
      await deleteObject(bindings, fileRecord.object_key).catch(ignorePromiseRejection);
    }
  }

  await deleteFileControlRows(bindings.DB, {
    fileIds: descendantFiles.map((file) => file.id),
    uploadIds: descendantFiles.flatMap((file) => (file.uploadId === null ? [] : [file.uploadId])),
  });

  await getAppDatabase(bindings.DB)
    .delete(spaceDirectoriesTable)
    .where(
      and(
        eq(spaceDirectoriesTable.spaceId, input.spaceId),
        or(
          eq(spaceDirectoriesTable.path, normalizedKey),
          sql`${spaceDirectoriesTable.path} LIKE ${`${escapedKey}/%`} ESCAPE '\\'`,
        ),
      ),
    )
    .run();
}
