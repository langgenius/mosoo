import { driverInstancesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, AppId, SessionId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { ensureAppOwnership } from "../../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { sessionParticipantCondition } from "../../../sessions/domain/session-access.policy";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";

interface ResolveDriverPermissionInput {
  decision: "allow_once" | "reject_once";
  driverInstanceId: DriverInstanceId;
  appId: AppId;
  requestId: string;
  sessionId: SessionId;
}

export async function resolvePermissionRequest(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ResolveDriverPermissionInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer id");
  await ensureAppOwnership(bindings.DB, viewerId, input.appId);
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        sessionId: sessionsTable.id,
      })
      .from(driverInstancesTable)
      .innerJoin(
        sessionRunsTable,
        and(
          eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.appId, input.appId),
          sessionParticipantCondition(viewerId),
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
