import { driverInstancesTable } from "@mosoo/db";
import { and, inArray, isNull, lte, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { toDriverInstanceStatusLifecycleEventName } from "../../domain/driver-instance-lifecycle.machine";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../../domain/runtime-config";
import { driverInstanceExpiresAt } from "./status";

export async function cleanupDriverInstances(bindings: ApiBindings): Promise<void> {
  const now = currentTimestampMs();
  const failedStatusPatch = {
    expiresAt: driverInstanceExpiresAt(now),
    status: "failed",
    statusChangedAt: now,
    statusEvent: toDriverInstanceStatusLifecycleEventName("failed"),
    statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
    statusSource: "maintenance",
    updatedAt: now,
  } as const;

  await getAppDatabase(bindings.DB)
    .update(driverInstancesTable)
    .set({
      ...failedStatusPatch,
      errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, 'Boot token expired.')`,
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
    .update(driverInstancesTable)
    .set({
      ...failedStatusPatch,
      closeCode: sql`COALESCE(${driverInstancesTable.closeCode}, 1011)`,
      closeReason: sql`COALESCE(${driverInstancesTable.closeReason}, 'runtime.heartbeat_timeout')`,
      errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, 'Runtime driver heartbeat timed out.')`,
    })
    .where(
      and(
        inArray(driverInstancesTable.status, ["connecting", "ready", "stopping"]),
        lte(
          sql<number>`COALESCE(${driverInstancesTable.lastHeartbeatAt}, ${driverInstancesTable.updatedAt})`,
          now - RUNTIME_SOCKET_TIMEOUT_MS,
        ),
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
