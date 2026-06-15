import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createFileConflictError,
  createFileDeleteFailedError,
  createFileNotFoundError,
  isRetryableFileControlError,
} from "./file-errors";
import { createDownloadDisposition } from "./file-paths";
import {
  deleteFileControlRows,
  ensureFileAccess,
  markFileRecordsDeleting,
} from "./file-record-store";
import { deleteObject, getObjectBody } from "./r2-s3-client";
import { ensureSpaceFileWriteUnlocked } from "./space-file-lock";
import {
  commitPendingSpaceFileVersionSafely,
  createPendingSpaceFileVersion,
} from "./space-file-version-store";

export async function streamFileContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  disposition: "attachment" | "inline" = "attachment",
): Promise<Response> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "view",
    viewer,
  });

  if (file.status !== "ready") {
    throw createFileConflictError("Only a ready file can be downloaded.");
  }

  const object = await getObjectBody(bindings, file.object_key);

  if (!object?.body) {
    throw createFileNotFoundError("File content was not found in R2.");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", createDownloadDisposition(file.name, disposition));
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, {
    headers,
  });
}

export async function deleteFileById(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  options: { ifMatchEtag?: string | null | undefined } = {},
): Promise<void> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });

  if (file.status !== "ready" && file.status !== "deleting") {
    throw createFileConflictError("Only a ready file can be deleted.");
  }

  if (file.scope_kind === "space") {
    await ensureSpaceFileWriteUnlocked(
      bindings,
      viewer,
      parsePlatformId<SpaceId>(file.scope_id, "file space ID"),
      file.path,
    );
  }

  try {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const pendingVersion =
      file.status === "ready"
        ? await createPendingSpaceFileVersion(bindings, file, viewerId, "delete")
        : null;

    await commitPendingSpaceFileVersionSafely(bindings, pendingVersion, {
      fileId,
      objectKey: file.object_key,
      path: file.path,
      reason: "delete",
      scopeId: file.scope_id,
    });
    await markFileRecordsDeleting(bindings.DB, { fileIds: [fileId] });
    await deleteObject(bindings, file.object_key, {
      ifMatch:
        file.status === "ready" ? (options.ifMatchEtag ?? file.etag ?? undefined) : undefined,
    });
  } catch (error) {
    if (isRetryableFileControlError(error)) {
      throw createFileDeleteFailedError(error.message);
    }

    throw error;
  }

  await deleteFileControlRows(bindings.DB, { fileIds: [fileId] });
}
