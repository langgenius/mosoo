import { driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { toDriverInstanceStatusLifecycleEventName } from "../../domain/driver-instance-lifecycle.machine";

export async function claimDriverInstanceByBootTokenHash(
  bindings: ApiBindings,
  bootTokenHash: Uint8Array,
): Promise<{ driverInstanceId: DriverInstanceId; generation: number } | null> {
  const now = currentTimestampMs();

  return (
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        bootTokenUsedAt: now,
        status: "connecting",
        statusChangedAt: now,
        statusEvent: toDriverInstanceStatusLifecycleEventName("connecting"),
        statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
        statusSource: "driver",
        updatedAt: now,
      })
      .where(
        and(
          eq(driverInstancesTable.bootTokenHash, bootTokenHash),
          eq(driverInstancesTable.status, "provisioning"),
          isNull(driverInstancesTable.bootTokenUsedAt),
          gt(driverInstancesTable.bootTokenExpiresAt, now),
        ),
      )
      .returning({
        driverInstanceId: driverInstancesTable.id,
        generation: driverInstancesTable.generation,
      })
      .get()) ?? null
  );
}
