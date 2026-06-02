import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";
import { getDriverInstanceSnapshot } from "./driver-instance/client";
import type { DriverInstanceStatus } from "./driver-instance/status";

export async function getDriverUsage(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<{
  sessionRunId: SessionRunId | null;
  status: DriverInstanceStatus;
} | null> {
  const appDb = getAppDatabase(database);
  const row =
    (await appDb
      .select({
        status: driverInstancesTable.status,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const activeRun =
    (await appDb
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return {
    sessionRunId: activeRun?.id ?? null,
    status: row.status,
  };
}

export async function driverReadySocketIsConnected(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
): Promise<boolean> {
  const snapshot = await getDriverInstanceSnapshot(bindings, driverInstanceId);
  return snapshot.driverSocketConnected;
}
