import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";
import type { DriverInstanceStatus } from "./driver-instance/status";

export async function getActiveDriverSessionRunId(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<SessionRunId | null> {
  const row =
    (await getAppDatabase(database)
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

  return row?.id ?? null;
}

export async function getDriverUsage(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<{
  sessionRunId: SessionRunId | null;
  status: DriverInstanceStatus;
} | null> {
  const row =
    (await getAppDatabase(database)
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

  return {
    sessionRunId: await getActiveDriverSessionRunId(database, driverInstanceId),
    status: row.status,
  };
}
