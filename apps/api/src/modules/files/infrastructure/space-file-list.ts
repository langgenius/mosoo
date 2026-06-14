import type { SpaceFileListing } from "@mosoo/contracts/space";
import { fileRecordsTable, spaceDirectoriesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, SpaceId } from "@mosoo/id";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listSpaceAccessRows } from "../../spaces/domain/space-access.policy";
import { normalizeSpaceDirectoryPath } from "./file-paths";
import { ensureSpaceAccess } from "./space-access";
import { listActiveSpaceFileLocks } from "./space-file-lock";

export async function listSpaceFiles(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceId: SpaceId,
  path?: string,
): Promise<SpaceFileListing> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, appId, spaceId, "read");
  const parentPath = normalizeSpaceDirectoryPath(path);

  const directoryRows = await getAppDatabase(bindings.DB)
    .select({ path: spaceDirectoriesTable.path })
    .from(spaceDirectoriesTable)
    .where(
      and(
        eq(spaceDirectoriesTable.spaceId, spaceId),
        eq(spaceDirectoriesTable.parentPath, parentPath),
        sql`${spaceDirectoriesTable.name} NOT LIKE '.%'`,
      ),
    )
    .orderBy(asc(sql<string>`lower(${spaceDirectoriesTable.name})`))
    .all();

  const fileRows = await getAppDatabase(bindings.DB)
    .select({
      etag: fileRecordsTable.etag,
      id: fileRecordsTable.id,
      mime_type: fileRecordsTable.mimeType,
      path: fileRecordsTable.path,
      size: fileRecordsTable.size,
      updated_at: fileRecordsTable.updatedAt,
      version: fileRecordsTable.version,
    })
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "space"),
        eq(fileRecordsTable.scopeId, spaceId),
        eq(fileRecordsTable.parentPath, parentPath),
        eq(fileRecordsTable.status, "ready"),
        sql`${fileRecordsTable.name} NOT LIKE '.%'`,
      ),
    )
    .orderBy(asc(sql<string>`lower(${fileRecordsTable.name})`))
    .all();
  const locks = await listActiveSpaceFileLocks(
    bindings,
    spaceId,
    fileRows.map((row) => row.path),
  );

  return {
    directories: directoryRows.map((row) => ({
      key: `${row.path}/`,
    })),
    files: fileRows.map((row) => ({
      etag: row.etag,
      id: row.id,
      key: row.path,
      lock: locks.get(row.path) ?? null,
      mimeType: row.mime_type,
      size: row.size,
      uploadedAt: toIsoString(row.updated_at),
      version: row.version,
    })),
  };
}

export interface SpaceRootFileSummaryListing {
  directories: {
    key: string;
  }[];
  files: {
    key: string;
    mimeType: string | null;
    size: number;
  }[];
}

export async function listSpaceRootFileSummaries(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceIds: readonly SpaceId[],
): Promise<Map<SpaceId, SpaceRootFileSummaryListing>> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await listSpaceAccessRows(bindings.DB, viewerId, appId, spaceIds);
  const accessibleSpaceIds = [...access.accessibleRowsById.keys()];

  if (accessibleSpaceIds.length === 0) {
    return new Map();
  }

  const database = getAppDatabase(bindings.DB);
  const [directoryRows, fileRows] = await Promise.all([
    database
      .select({
        path: spaceDirectoriesTable.path,
        spaceId: spaceDirectoriesTable.spaceId,
      })
      .from(spaceDirectoriesTable)
      .where(
        and(
          inArray(spaceDirectoriesTable.spaceId, accessibleSpaceIds),
          eq(spaceDirectoriesTable.parentPath, ""),
          sql`${spaceDirectoriesTable.name} NOT LIKE '.%'`,
        ),
      )
      .orderBy(asc(sql<string>`lower(${spaceDirectoriesTable.name})`))
      .all(),
    database
      .select({
        mimeType: fileRecordsTable.mimeType,
        path: fileRecordsTable.path,
        scopeId: fileRecordsTable.scopeId,
        size: fileRecordsTable.size,
      })
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, "space"),
          inArray(fileRecordsTable.scopeId, accessibleSpaceIds),
          eq(fileRecordsTable.parentPath, ""),
          eq(fileRecordsTable.status, "ready"),
          sql`${fileRecordsTable.name} NOT LIKE '.%'`,
        ),
      )
      .orderBy(asc(sql<string>`lower(${fileRecordsTable.name})`))
      .all(),
  ]);
  const listingsBySpaceId = new Map<SpaceId, SpaceRootFileSummaryListing>();

  for (const spaceId of accessibleSpaceIds) {
    listingsBySpaceId.set(spaceId, {
      directories: [],
      files: [],
    });
  }

  for (const row of directoryRows) {
    listingsBySpaceId.get(row.spaceId)?.directories.push({
      key: `${row.path}/`,
    });
  }

  for (const row of fileRows) {
    const spaceId = parsePlatformId<SpaceId>(row.scopeId, "space file summary scope ID");
    listingsBySpaceId.get(spaceId)?.files.push({
      key: row.path,
      mimeType: row.mimeType,
      size: row.size,
    });
  }

  return listingsBySpaceId;
}
