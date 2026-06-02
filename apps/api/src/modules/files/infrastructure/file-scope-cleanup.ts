import type { FileScopeId, FileScopeKind } from "@mosoo/contracts/file";
import { ignorePromiseRejection } from "@mosoo/effects";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  deleteFileControlRowsForScope,
  listFilesForScopeCleanup,
  markFileRecordsDeleting,
} from "./file-record-store";
import { abortMultipartUpload, deleteObject } from "./r2-s3-client";
import {
  commitPendingSpaceFileVersionSafely,
  createPendingSpaceFileVersion,
} from "./space-file-version-store";

export async function deleteFilesForScope(
  bindings: ApiBindings,
  input: {
    actorAccountId?: AccountId | undefined;
    scopeId: FileScopeId;
    scopeKind: FileScopeKind;
  },
): Promise<void> {
  const rows = await listFilesForScopeCleanup(bindings.DB, input);

  for (const row of rows) {
    if (row.strategy === "multipart" && row.multipartUploadId !== null) {
      await abortMultipartUpload(bindings, row.object_key, row.multipartUploadId).catch(
        ignorePromiseRejection,
      );
    }

    const actorAccountId = input.actorAccountId;
    const shouldVersionBeforeDelete =
      row.scope_kind === "space" &&
      row.status === "ready" &&
      actorAccountId !== undefined &&
      actorAccountId.length > 0;

    if (shouldVersionBeforeDelete) {
      const pendingVersion = await createPendingSpaceFileVersion(
        bindings,
        row,
        actorAccountId,
        "space_delete",
      );

      await commitPendingSpaceFileVersionSafely(bindings, pendingVersion, {
        fileId: row.id,
        objectKey: row.object_key,
        path: row.path,
        reason: "space_delete",
        scopeId: row.scope_id,
      });
      await markFileRecordsDeleting(bindings.DB, { fileIds: [row.id] });
      await deleteObject(bindings, row.object_key, {
        ifMatch: row.etag ?? undefined,
      });
    } else {
      await markFileRecordsDeleting(bindings.DB, { fileIds: [row.id] });
      await deleteObject(bindings, row.object_key).catch(ignorePromiseRejection);
    }
  }

  await deleteFileControlRowsForScope(bindings.DB, input);
}
