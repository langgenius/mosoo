import { getParentPath } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SpaceId } from "@mosoo/id";
import { and, asc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureSpaceParentDirectories } from "../../files/application/space-directory.service";
import { toSessionArtifactViewFile } from "../../sessions/application/session-view-file.service";
import type { RuntimeArtifactSummaryChange } from "./runtime-space-file-changes";
import { createRuntimeSpaceObjectKey, getRuntimeSpaceFileName } from "./runtime-space-paths";
import type { RuntimeSpacePathResolution } from "./runtime-space-paths";

type RuntimeSpaceFileDeleteChange = Extract<RuntimeArtifactSummaryChange, { change: "delete" }>;
type RuntimeSpaceFileUpsertChange = Extract<RuntimeArtifactSummaryChange, { change: "upsert" }>;

export interface RuntimeSpaceCanonicalFile {
  readonly objectKey: string;
  readonly path: string;
}

export interface RuntimeSpaceFileRecordDeleteResult {
  readonly artifactChange: RuntimeSpaceFileDeleteChange | null;
  readonly deletedObjectKey: string | null;
}

export interface RuntimeSpaceFileRecordUpsertInput {
  readonly database: D1Database;
  readonly etag?: string | null;
  readonly ownerUserId: string;
  readonly resolution: RuntimeSpacePathResolution;
  readonly size: number;
}

export interface RuntimeSpaceFileRecordUpsertResult {
  readonly artifactChange: RuntimeSpaceFileUpsertChange;
  readonly replacedObjectKey: string | null;
}

export async function deleteRuntimeSpaceFileRecord(
  database: D1Database,
  resolution: RuntimeSpacePathResolution,
): Promise<RuntimeSpaceFileRecordDeleteResult> {
  const spaceId = parsePlatformId<SpaceId>(resolution.spaceId, "space id");
  const match = and(
    eq(fileRecordsTable.scopeKind, "space"),
    eq(fileRecordsTable.scopeId, spaceId),
    eq(fileRecordsTable.path, resolution.relativePath),
    eq(fileRecordsTable.status, "ready"),
  );
  const existing =
    (await getAppDatabase(database)
      .select({
        id: fileRecordsTable.id,
        object_key: fileRecordsTable.objectKey,
      })
      .from(fileRecordsTable)
      .where(match)
      .limit(1)
      .get()) ?? null;

  await getAppDatabase(database).delete(fileRecordsTable).where(match).run();

  if (!existing) {
    return {
      artifactChange: null,
      deletedObjectKey: null,
    };
  }

  return {
    artifactChange: {
      change: "delete",
      fileId: existing.id,
    },
    deletedObjectKey: existing.object_key,
  };
}

export async function listRuntimeSpaceFileRecords(
  database: D1Database,
  spaceId: string,
): Promise<RuntimeSpaceCanonicalFile[]> {
  const parsedSpaceId = parsePlatformId<SpaceId>(spaceId, "space id");
  const results = await getAppDatabase(database)
    .select({
      object_key: fileRecordsTable.objectKey,
      path: fileRecordsTable.path,
    })
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "space"),
        eq(fileRecordsTable.scopeId, parsedSpaceId),
        eq(fileRecordsTable.status, "ready"),
      ),
    )
    .orderBy(asc(fileRecordsTable.path))
    .all();

  return results.map((row) => ({
    objectKey: row.object_key,
    path: row.path,
  }));
}

export async function upsertRuntimeSpaceFileRecord(
  input: RuntimeSpaceFileRecordUpsertInput,
): Promise<RuntimeSpaceFileRecordUpsertResult> {
  const parentPath = getParentPath(input.resolution.relativePath);
  const objectKey = createRuntimeSpaceObjectKey(input.resolution);
  const timestampMs = currentTimestampMs();
  const name = getRuntimeSpaceFileName(input.resolution.relativePath);
  const ownerUserId = parsePlatformId<AccountId>(input.ownerUserId, "owner user id");
  const spaceId = parsePlatformId<SpaceId>(input.resolution.spaceId, "space id");

  await ensureSpaceParentDirectories(input.database, ownerUserId, spaceId, parentPath);

  const existing =
    (await getAppDatabase(input.database)
      .select({
        created_at: fileRecordsTable.createdAt,
        id: fileRecordsTable.id,
        mime_type: fileRecordsTable.mimeType,
        name: fileRecordsTable.name,
        object_key: fileRecordsTable.objectKey,
        size: fileRecordsTable.size,
      })
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, "space"),
          eq(fileRecordsTable.scopeId, spaceId),
          eq(fileRecordsTable.path, input.resolution.relativePath),
          eq(fileRecordsTable.status, "ready"),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (existing) {
    await updateRuntimeSpaceFileRecord(input, {
      fileId: existing.id,
      name,
      objectKey,
      parentPath,
      timestampMs,
    });

    return {
      artifactChange: {
        change: "upsert",
        file: toSessionArtifactViewFile({
          ...existing,
          name,
          size: input.size,
        }),
      },
      replacedObjectKey: existing.object_key === objectKey ? null : existing.object_key,
    };
  }

  const fileId = createPlatformId<FileId>();

  await getAppDatabase(input.database)
    .insert(fileRecordsTable)
    .values({
      committed: true,
      createdAt: timestampMs,
      createdByAccountId: ownerUserId,
      etag: input.etag ?? null,
      expiresAt: null,
      id: fileId,
      mimeType: null,
      name,
      objectKey,
      ownerId: spaceId,
      ownerKind: "space",
      parentPath,
      path: input.resolution.relativePath,
      purpose: "space_file",
      scopeId: spaceId,
      scopeKind: "space",
      sessionKind: null,
      size: input.size,
      status: "ready",
      updatedAt: timestampMs,
      version: 1,
    })
    .run();

  return {
    artifactChange: {
      change: "upsert",
      file: toSessionArtifactViewFile({
        created_at: timestampMs,
        id: fileId,
        mime_type: null,
        name,
        size: input.size,
      }),
    },
    replacedObjectKey: null,
  };
}

async function updateRuntimeSpaceFileRecord(
  input: RuntimeSpaceFileRecordUpsertInput,
  record: {
    readonly fileId: FileId;
    readonly name: string;
    readonly objectKey: string;
    readonly parentPath: string;
    readonly timestampMs: number;
  },
): Promise<void> {
  const updateValues = {
    name: record.name,
    objectKey: record.objectKey,
    parentPath: record.parentPath,
    size: input.size,
    updatedAt: record.timestampMs,
    version: sql`${fileRecordsTable.version} + 1`,
  };

  if ("etag" in input) {
    await getAppDatabase(input.database)
      .update(fileRecordsTable)
      .set({
        ...updateValues,
        etag: input.etag ?? null,
      })
      .where(eq(fileRecordsTable.id, record.fileId))
      .run();
    return;
  }

  await getAppDatabase(input.database)
    .update(fileRecordsTable)
    .set(updateValues)
    .where(eq(fileRecordsTable.id, record.fileId))
    .run();
}
