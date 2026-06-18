import { fileVersionsTable } from "@mosoo/db";
import type { FileVersionReason } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, FileId, FileVersionId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { FileControlError } from "./file-errors";
import type { FileRecordRow } from "./file-record-store";
import { getFileScopeDescriptor } from "./file-scope-descriptor";
import { copyObject, headObject, normalizeR2Etag } from "./r2-s3-client";

export interface PendingFileVersion {
  id: FileVersionId;
  objectKey: string;
}

interface FindPendingFileVersionInput {
  fileId: FileId;
  path: string;
  reason: FileVersionReason;
  sourceObjectKey: string;
  version: number;
}

function createVersionObjectKey(
  file: FileRecordRow,
  versionId: FileVersionId,
  path: string,
): string {
  return `file_versions/${file.scope_kind}/${file.scope_id ?? "unscoped"}/${versionId}/${path}`;
}

async function resolveSourceEtag(bindings: ApiBindings, file: FileRecordRow): Promise<string> {
  const storedEtag = normalizeR2Etag(file.etag);

  if (isTruthy(storedEtag)) {
    return storedEtag;
  }

  const object = await headObject(bindings, file.object_key);
  const objectEtag = normalizeR2Etag(object?.etag);

  if (!object || !isTruthy(objectEtag)) {
    throw new FileControlError(404, "file_not_found", "File was deleted by someone else.");
  }

  return objectEtag;
}

export async function createPendingFileVersion(
  bindings: ApiBindings,
  file: FileRecordRow,
  actorAccountId: AccountId,
  reason: FileVersionReason,
): Promise<PendingFileVersion | null> {
  if (!getFileScopeDescriptor(file.scope_kind).capabilities.versioning || file.status !== "ready") {
    return null;
  }

  const sourceEtag = await resolveSourceEtag(bindings, file);
  const versionId = createPlatformId<FileVersionId>();
  const versionObjectKey = createVersionObjectKey(file, versionId, file.path);
  const timestampMs = currentTimestampMs();

  await copyObject({
    bindings,
    destinationObjectKey: versionObjectKey,
    options: {
      destinationIfNoneMatch: "*",
      sourceIfMatch: sourceEtag,
    },
    sourceObjectKey: file.object_key,
  });

  await getAppDatabase(bindings.DB)
    .insert(fileVersionsTable)
    .values({
      committed: false,
      committedAt: null,
      createdAt: timestampMs,
      createdByAccountId: actorAccountId,
      fileId: file.id,
      id: versionId,
      mimeType: file.mime_type,
      objectKey: versionObjectKey,
      path: file.path,
      reason,
      scopeId: file.scope_id,
      scopeKind: file.scope_kind,
      size: file.size,
      sourceEtag,
      sourceObjectKey: file.object_key,
      version: file.version,
    })
    .run();

  return {
    id: versionId,
    objectKey: versionObjectKey,
  };
}

export async function findPendingFileVersion(
  database: D1Database,
  input: FindPendingFileVersionInput,
): Promise<PendingFileVersion | null> {
  return (
    (await getAppDatabase(database)
      .select({
        id: fileVersionsTable.id,
        objectKey: fileVersionsTable.objectKey,
      })
      .from(fileVersionsTable)
      .where(
        and(
          eq(fileVersionsTable.fileId, input.fileId),
          eq(fileVersionsTable.path, input.path),
          eq(fileVersionsTable.reason, input.reason),
          eq(fileVersionsTable.sourceObjectKey, input.sourceObjectKey),
          eq(fileVersionsTable.version, input.version),
          eq(fileVersionsTable.committed, false),
        ),
      )
      .orderBy(desc(fileVersionsTable.createdAt))
      .limit(1)
      .get()) ?? null
  );
}

async function commitPendingFileVersion(
  bindings: ApiBindings,
  version: PendingFileVersion | null,
): Promise<void> {
  if (!version) {
    return;
  }

  await getAppDatabase(bindings.DB)
    .update(fileVersionsTable)
    .set({
      committed: true,
      committedAt: currentTimestampMs(),
    })
    .where(eq(fileVersionsTable.id, version.id))
    .run();
}

export async function commitPendingFileVersionSafely(
  bindings: ApiBindings,
  version: PendingFileVersion | null,
  context: Record<string, boolean | number | string | null | undefined>,
): Promise<void> {
  try {
    await commitPendingFileVersion(bindings, version);
  } catch (error) {
    logError("file.version.commit.failed", {
      ...createErrorLogContext(error),
      ...context,
      versionId: version?.id,
      versionObjectKey: version?.objectKey,
    });
  }
}
