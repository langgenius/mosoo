import { driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId } from "@mosoo/id";
import { and, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";

export async function listLiveDriverInstanceRefsForSandboxSessions(
  database: D1Database,
  sandboxSessionIds: readonly SessionId[],
): Promise<
  {
    id: DriverInstanceId;
    sandboxSessionId: SessionId;
  }[]
> {
  const sessionIds = [...new Set(sandboxSessionIds)].filter(Boolean);

  if (sessionIds.length === 0) {
    return [];
  }

  return getAppDatabase(database)
    .select({
      id: driverInstancesTable.id,
      sandboxSessionId: driverInstancesTable.sandboxSessionId,
    })
    .from(driverInstancesTable)
    .where(
      and(
        inArray(driverInstancesTable.sandboxSessionId, sessionIds),
        inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
      ),
    )
    .all();
}

export async function listLiveDriverInstanceIdsForSandboxSessions(
  database: D1Database,
  sandboxSessionIds: readonly SessionId[],
): Promise<DriverInstanceId[]> {
  const rows = await listLiveDriverInstanceRefsForSandboxSessions(database, sandboxSessionIds);
  return rows.map((row) => row.id);
}
