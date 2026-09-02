import { driverInstancesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../../projects/application/project.service";
import { sessionParticipantCondition } from "../../../sessions/domain/session-access.policy";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { sendDriverInstanceCommand } from "../../infrastructure/driver-instance/client";

interface ResolveDriverPermissionInput {
  decision: "allow_once" | "reject_once";
  driverInstanceId: DriverInstanceId;
  projectId: ProjectId;
  requestId: string;
  runId: SessionRunId;
  sessionId: SessionId;
}

export async function resolvePermissionRequest(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ResolveDriverPermissionInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer id");
  await ensureProjectOwnership(bindings.DB, viewerId, input.projectId);
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        driverGeneration: driverInstancesTable.generation,
        runId: sessionRunsTable.id,
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
          eq(sessionRunsTable.id, input.runId),
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Driver instance not found.");
  }

  await sendDriverInstanceCommand(bindings, input.driverInstanceId, row.driverGeneration, {
    commandId: createPlatformId(),
    decision: input.decision,
    kind: "permission.resolve",
    requestId: input.requestId,
    runId: row.runId,
  });
}
