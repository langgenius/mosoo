import { resourceAclTable, spacesTable } from "@mosoo/db";
import type { SpaceId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export async function updateSpaceVisibilityAfterCollaboratorChange(
  database: D1Database,
  spaceId: SpaceId,
): Promise<void> {
  const db = getAppDatabase(database);
  const state =
    (await db
      .select({
        collaboratorAclCount: sql<number>`COALESCE(
          SUM(
            CASE
              WHEN ${resourceAclTable.targetKind} != 'user'
                OR ${resourceAclTable.targetId} != ${spacesTable.ownerAccountId}
              THEN 1
              ELSE 0
            END
          ),
          0
        )`.mapWith(Number),
        organizationAclCount: sql<number>`COALESCE(
          SUM(
            CASE
              WHEN ${resourceAclTable.targetKind} = 'organization' THEN 1
              ELSE 0
            END
          ),
          0
        )`.mapWith(Number),
      })
      .from(spacesTable)
      .leftJoin(
        resourceAclTable,
        and(
          eq(resourceAclTable.resourceType, "space"),
          eq(resourceAclTable.resourceId, spacesTable.id),
        ),
      )
      .where(eq(spacesTable.id, spaceId))
      .groupBy(spacesTable.id)
      .limit(1)
      .get()) ?? null;

  if (state === null) {
    throw new Error("Space not found.");
  }

  const nextVisibility =
    state.organizationAclCount > 0 || state.collaboratorAclCount > 0 ? "shared" : "private";

  await db
    .update(spacesTable)
    .set({
      updatedAt: currentTimestampMs(),
      visibility: nextVisibility,
    })
    .where(eq(spacesTable.id, spaceId))
    .run();
}
