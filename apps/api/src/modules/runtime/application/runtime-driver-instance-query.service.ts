import type { DriverInstanceId, SessionId } from "@mosoo/id";

import { listLiveDriverInstanceIdsForSandboxSessions } from "../infrastructure/driver-instance/live-driver-instance.repository";

export async function listLiveRuntimeDriverInstanceIdsForSession(
  database: D1Database,
  sessionId: SessionId,
): Promise<DriverInstanceId[]> {
  return listLiveDriverInstanceIdsForSandboxSessions(database, [sessionId]);
}
