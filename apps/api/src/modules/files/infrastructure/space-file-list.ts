import type { SpaceFileListing } from "@mosoo/contracts/space";
import { fileRecordsTable, spaceDirectoriesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";
import { and, asc, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeSpaceDirectoryPath } from "./file-paths";
import { ensureSpaceAccess } from "./space-access";
import { listActiveSpaceFileLocks } from "./space-file-lock";

export async function listSpaceFiles(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
  path?: string,
): Promise<SpaceFileListing> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, spaceId, "read");
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
