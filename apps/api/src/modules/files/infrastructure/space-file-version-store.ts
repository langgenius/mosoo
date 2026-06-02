import { spaceFileVersionsTable } from "@mosoo/db";
import type { SpaceFileVersionReason } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SpaceFileVersionId, SpaceId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { FileControlError } from "./file-errors";
import type { FileRecordRow } from "./file-record-store";
import { copyObject, headObject, normalizeR2Etag } from "./r2-s3-client";
export interface PendingSpaceFileVersion {
  id: SpaceFileVersionId;
  objectKey: string;
}

interface FindPendingSpaceFileVersionInput {
  fileId: FileId;
  path: string;
  reason: SpaceFileVersionReason;
  sourceObjectKey: string;
  version: number;
}

function createVersionObjectKey(
  spaceId: SpaceId,
  versionId: SpaceFileVersionId,
  path: string,
): string {
  return `space_versions/${spaceId}/${versionId}/${path}`;
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

export async function createPendingSpaceFileVersion(
  bindings: ApiBindings,
  file: FileRecordRow,
  actorAccountId: AccountId,
  reason: SpaceFileVersionReason,
): Promise<PendingSpaceFileVersion | null> {
  if (file.scope_kind !== "space" || file.status !== "ready") {
    return null;
  }

  const sourceEtag = await resolveSourceEtag(bindings, file);
  const versionId = createPlatformId<SpaceFileVersionId>();
  const spaceId: SpaceId = parsePlatformId(file.scope_id, "file space ID");
  const versionObjectKey = createVersionObjectKey(spaceId, versionId, file.path);
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
    .insert(spaceFileVersionsTable)
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
      size: file.size,
      sourceEtag,
      sourceObjectKey: file.object_key,
      spaceId,
      version: file.version,
    })
    .run();

  return {
    id: versionId,
    objectKey: versionObjectKey,
  };
}

export async function findPendingSpaceFileVersion(
  database: D1Database,
  input: FindPendingSpaceFileVersionInput,
): Promise<PendingSpaceFileVersion | null> {
  return (
    (await getAppDatabase(database)
      .select({
        id: spaceFileVersionsTable.id,
        objectKey: spaceFileVersionsTable.objectKey,
      })
      .from(spaceFileVersionsTable)
      .where(
        and(
          eq(spaceFileVersionsTable.fileId, input.fileId),
          eq(spaceFileVersionsTable.path, input.path),
          eq(spaceFileVersionsTable.reason, input.reason),
          eq(spaceFileVersionsTable.sourceObjectKey, input.sourceObjectKey),
          eq(spaceFileVersionsTable.version, input.version),
          eq(spaceFileVersionsTable.committed, false),
        ),
      )
      .orderBy(desc(spaceFileVersionsTable.createdAt))
      .limit(1)
      .get()) ?? null
  );
}

async function commitPendingSpaceFileVersion(
  bindings: ApiBindings,
  version: PendingSpaceFileVersion | null,
): Promise<void> {
  if (!version) {
    return;
  }

  await getAppDatabase(bindings.DB)
    .update(spaceFileVersionsTable)
    .set({
      committed: true,
      committedAt: currentTimestampMs(),
    })
    .where(eq(spaceFileVersionsTable.id, version.id))
    .run();
}

export async function commitPendingSpaceFileVersionSafely(
  bindings: ApiBindings,
  version: PendingSpaceFileVersion | null,
  context: Record<string, boolean | number | string | null | undefined>,
): Promise<void> {
  try {
    await commitPendingSpaceFileVersion(bindings, version);
  } catch (error) {
    logError("space.file.version.commit.failed", {
      ...createErrorLogContext(error),
      ...context,
      versionId: version?.id,
      versionObjectKey: version?.objectKey,
    });
  }
}
