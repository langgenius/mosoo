import { driverInstancesTable } from "@mosoo/db";
import { and, inArray, isNull, lte, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { toDriverInstanceStatusLifecycleEventName } from "../../domain/driver-instance-lifecycle.machine";
import { driverInstanceExpiresAt } from "./status";

export async function cleanupDriverInstances(bindings: ApiBindings): Promise<void> {
  const now = currentTimestampMs();

  await getAppDatabase(bindings.DB)
    .update(driverInstancesTable)
    .set({
      errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, 'Boot token expired.')`,
      expiresAt: driverInstanceExpiresAt(now),
      status: "failed",
      statusChangedAt: now,
      statusEvent: toDriverInstanceStatusLifecycleEventName("failed"),
      statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
      statusSource: "maintenance",
      updatedAt: now,
    })
    .where(
      and(
        sql`${driverInstancesTable.status} = 'provisioning'`,
        isNull(driverInstancesTable.bootTokenUsedAt),
        lte(driverInstancesTable.bootTokenExpiresAt, now),
      ),
    )
    .run();

  await getAppDatabase(bindings.DB)
    .delete(driverInstancesTable)
    .where(
      and(
        inArray(driverInstancesTable.status, ["stopped", "failed"]),
        lte(driverInstancesTable.expiresAt, now),
      ),
    )
    .run();
}
