import { driverInstancesTable, externalToolEffectsTable, sessionsTable } from "@mosoo/db";
import { and, eq, inArray, isNotNull, isNull, lte, notExists, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { toDriverInstanceStatusLifecycleEventName } from "../../domain/driver-instance-lifecycle.machine";
import {
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../../domain/runtime-config";
import { repairClaimedDriverStopsGlobally } from "../driver-session-stop.service";
import { driverInstanceExpiresAt } from "./status";
import { repairTerminalDriverRuntimeCommandsGlobally } from "./terminal-run-release";

export async function cleanupDriverInstances(bindings: ApiBindings): Promise<void> {
  const database = getAppDatabase(bindings.DB);
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

  await database
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

  await database
    .update(driverInstancesTable)
    .set({
      ...failedStatusPatch,
      closeCode: sql`COALESCE(${driverInstancesTable.closeCode}, 1011)`,
      closeReason: sql`COALESCE(${driverInstancesTable.closeReason}, 'runtime.heartbeat_timeout')`,
      errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, 'Runtime driver heartbeat timed out.')`,
    })
    .where(
      and(
        eq(driverInstancesTable.status, "connecting"),
        lte(
          sql<number>`COALESCE(${driverInstancesTable.lastHeartbeatAt}, ${driverInstancesTable.updatedAt})`,
          now - DRIVER_COLD_READY_TIMEOUT_MS,
        ),
      ),
    )
    .run();

  await database
    .update(driverInstancesTable)
    .set({
      ...failedStatusPatch,
      closeCode: sql`COALESCE(${driverInstancesTable.closeCode}, 1011)`,
      closeReason: sql`COALESCE(${driverInstancesTable.closeReason}, 'runtime.heartbeat_timeout')`,
      errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, 'Runtime driver heartbeat timed out.')`,
    })
    .where(
      and(
        inArray(driverInstancesTable.status, ["ready", "stopping"]),
        lte(
          sql<number>`COALESCE(${driverInstancesTable.lastHeartbeatAt}, ${driverInstancesTable.updatedAt})`,
          now - RUNTIME_SOCKET_TIMEOUT_MS,
        ),
      ),
    )
    .run();

  try {
    await repairTerminalDriverRuntimeCommandsGlobally(bindings);
  } catch {
    // A Driver-owned stop can temporarily fence terminal cleanup. The stop
    // pass below owns convergence; the final terminal pass reports anything
    // that remains unresolved.
  }
  let stopRepairError: unknown;
  try {
    await repairClaimedDriverStopsGlobally(bindings);
  } catch (error) {
    stopRepairError = error;
  }
  // A Driver-owned stop may be the fence that kept the first terminal pass
  // from claiming its Run. Run terminal convergence again against the now
  // non-assignable Driver.
  await repairTerminalDriverRuntimeCommandsGlobally(bindings);
  if (stopRepairError !== undefined) {
    throw stopRepairError;
  }

  await database
    .delete(driverInstancesTable)
    .where(
      and(
        inArray(driverInstancesTable.status, ["stopped", "failed"]),
        isNull(driverInstancesTable.statusOperationId),
        lte(driverInstancesTable.expiresAt, now),
        notExists(
          database
            .select({ id: externalToolEffectsTable.id })
            .from(externalToolEffectsTable)
            .where(
              and(
                eq(externalToolEffectsTable.driverInstanceId, driverInstancesTable.id),
                inArray(externalToolEffectsTable.status, ["claimed", "unknown"]),
              ),
            ),
        ),
        notExists(
          database
            .select({ id: sessionsTable.id })
            .from(sessionsTable)
            .where(
              and(
                eq(sessionsTable.id, driverInstancesTable.sandboxSessionId),
                eq(sessionsTable.runtimeProvisioningSandboxId, driverInstancesTable.sandboxId),
                isNotNull(sessionsTable.runtimeProvisioningOperationId),
              ),
            ),
        ),
      ),
    )
    .run();
}
