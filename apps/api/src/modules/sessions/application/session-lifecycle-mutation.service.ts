import type { AgentSessionActionCapabilityName } from "@mosoo/contracts/session";
import { sandboxSessionsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { ProjectId, SessionId, SessionRunId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../runtime/domain/session-run-lifecycle.machine";
import { listLiveDriverInstanceIdsForSandboxSessions } from "../../runtime/infrastructure/driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../../runtime/infrastructure/driver-session-stop.service";
import { closeSandboxConversationSession } from "../../runtime/infrastructure/sandbox-session/sandbox-conversation-session.service";
import { createSessionStatusTransitionPatch } from "../../runtime/infrastructure/session-runs/session-lifecycle-projection.repository";
import { setSessionRunStatus } from "../../runtime/infrastructure/session-runs/session-run-store.repository";
import { findProjectSession, requireProjectSession } from "../domain/session-access.policy";
import type { ProjectSessionRow } from "../domain/session-access.policy";
import { closeSessionViewerSockets } from "../infrastructure/session/client";
import { deleteSessionCascade } from "./session-cleanup.service";

interface SessionMutationRequest {
  bindings: ApiBindings;
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

interface UnarchiveAgentSessionRequest {
  database: D1Database;
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

const ARCHIVED_RUN_ERROR = {
  code: "session.archived",
  details: {},
  message: "Session was archived before the run completed.",
  retryable: false,
} as const;

function ensureLifecycleActionCapability(
  action: AgentSessionActionCapabilityName,
  session: ProjectSessionRow,
): void {
  getAvailableAgentSessionActionCapability({
    action,
    archivedAt: session.archived_at,
    runtimeId: session.runtime_id,
    status: session.status,
  });
}

async function listActiveSessionRunIds(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionRunId[]> {
  const rows = await getAppDatabase(database)
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.sessionId, sessionId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .all();

  return rows.map((row) => row.id);
}

async function cancelActiveSessionRunsForLifecycle(
  database: D1Database,
  sessionId: SessionId,
): Promise<void> {
  const activeRunIds = await listActiveSessionRunIds(database, sessionId);

  for (const runId of activeRunIds) {
    await setSessionRunStatus(database, {
      error: ARCHIVED_RUN_ERROR,
      runId,
      source: "system",
      status: "cancelled",
    });
  }
}

async function normalizeSessionRuntimeLifecycle(
  database: D1Database,
  sessionId: SessionId,
): Promise<void> {
  await cancelActiveSessionRunsForLifecycle(database, sessionId);

  await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: "IDLE",
        timestampMs: currentTimestampMs(),
      }),
    )
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        inArray(sessionsTable.status, ["RUNNING", "RESCHEDULING"]),
      ),
    )
    .run();
}

export async function archiveAgentSession({
  bindings,
  projectId,
  sessionId,
  viewer,
}: SessionMutationRequest): Promise<void> {
  const session = await requireProjectSession(bindings.DB, viewer.id, { projectId, sessionId });
  ensureLifecycleActionCapability("archive_session", session);

  await writeSessionArchivedAt(bindings.DB, {
    archivedAt: currentTimestampMs(),
    projectId,
    sessionId,
  });
  await closeSessionViewerSockets(bindings, sessionId, "session.archived");

  const sandboxSession =
    (await getAppDatabase(bindings.DB)
      .select({ sandbox_id: sandboxSessionsTable.sandboxId })
      .from(sandboxSessionsTable)
      .where(eq(sandboxSessionsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null;
  const liveDriverInstanceIds = await listLiveDriverInstanceIdsForSandboxSessions(bindings.DB, [
    sessionId,
  ]);

  await Promise.all(
    liveDriverInstanceIds.map((driverInstanceId) =>
      stopDriverSession(bindings, {
        driverInstanceId,
        reason: "session.archived",
        terminalRun: {
          error: ARCHIVED_RUN_ERROR,
          status: "cancelled",
        },
      }),
    ),
  );
  await normalizeSessionRuntimeLifecycle(bindings.DB, sessionId);

  if (sandboxSession !== null) {
    await closeSandboxConversationSession(bindings, {
      sandboxId: sandboxSession.sandbox_id,
      sessionId,
    });
  }
}

export async function unarchiveAgentSession({
  database,
  projectId,
  sessionId,
  viewer,
}: UnarchiveAgentSessionRequest): Promise<void> {
  const session = await requireProjectSession(database, viewer.id, { projectId, sessionId });
  ensureLifecycleActionCapability("unarchive_session", session);

  await normalizeSessionRuntimeLifecycle(database, sessionId);

  await writeSessionArchivedAt(database, { archivedAt: null, projectId, sessionId });
}

async function writeSessionArchivedAt(
  database: D1Database,
  input: { archivedAt: number | null; projectId: ProjectId; sessionId: SessionId },
): Promise<void> {
  await getAppDatabase(database)
    .update(sessionsTable)
    .set({ archivedAt: input.archivedAt, updatedAt: currentTimestampMs() })
    .where(and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)))
    .run();
}

export async function deleteAgentSession({
  bindings,
  projectId,
  sessionId,
  viewer,
}: SessionMutationRequest): Promise<void> {
  const session = await findProjectSession(bindings.DB, viewer.id, { projectId, sessionId });

  // Delete must stay idempotent: clients can hold a session id that was
  // already removed (stale tab, replaced preview session). Treat the missing
  // row as deleted instead of reporting a permission error.
  if (session === null) {
    await ensureProjectOwnership(bindings.DB, viewer.id, projectId);
    return;
  }

  ensureLifecycleActionCapability("delete_session", session);

  await deleteSessionCascade(bindings, sessionId);
}
