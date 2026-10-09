import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";

interface ResolveDriverPermissionInput {
  decision: "allow_once" | "reject_once";
  driverInstanceId: DriverInstanceId;
  requestId: string;
  sessionId: SessionId;
}

// The caller authorized the Session. The Driver id comes from Driver-emitted
// live state, so it must belong to an active Run of that Session.
export async function resolvePermissionRequest(
  bindings: ApiBindings,
  input: ResolveDriverPermissionInput,
): Promise<void> {
  const row =
    (await getAppDatabase(bindings.DB)
      .select({ sessionId: sessionRunsTable.sessionId })
      .from(driverInstancesTable)
      .innerJoin(
        sessionRunsTable,
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(sessionRunsTable.sessionId, input.sessionId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Driver instance not found.");
  }

  await sendDriverInstanceCommand(bindings, input.driverInstanceId, {
    commandId: createPlatformId(),
    decision: input.decision,
    kind: "permission.resolve",
    requestId: input.requestId,
  });
}
