import type { AgentSessionActionCapabilityName } from "@mosoo/contracts/session";
import { sandboxSessionsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { AppId, SessionId, SessionRunId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listLiveRuntimeDriverInstanceIdsForSession } from "../../runtime/application/runtime-driver-instance-query.service";
import {
  closeSandboxConversationSession,
  stopDriverSession,
} from "../../runtime/application/runtime-session-lifecycle.service";
import {
  createSessionStatusTransitionPatch,
  setSystemSessionRunStatus,
} from "../../runtime/application/session-lifecycle-transition.service";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../runtime/domain/session-run-lifecycle.machine";
import type {
  SessionActionAuthorization,
  SessionParticipantCapabilityAccessRow,
} from "../domain/session-access.policy";
import {
  getAppSessionParticipantCapabilityAccess,
  resolveSessionActionCreatorFlag,
} from "../domain/session-access.policy";
import {
  SESSION_ARCHIVE_CLEANUP_STEPS,
  completeSessionArchiveCleanupStep,
  shouldSkipSessionArchiveCleanupStep,
  skipSessionArchiveCleanupStep,
} from "../domain/session-cleanup-plan";
import type {
  SessionArchiveCleanupStep,
  SessionArchiveCleanupStepOutcome,
  SessionArchiveCleanupTargets,
} from "../domain/session-cleanup-plan";
import { closeSessionViewerSockets } from "../infrastructure/session/client";
import { deleteSessionCascade } from "./session-cleanup.service";

export interface ArchiveAgentSessionRequest {
  authorization?: SessionActionAuthorization | undefined;
  bindings: ApiBindings;
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export interface UnarchiveAgentSessionRequest {
  authorization?: SessionActionAuthorization | undefined;
  database: D1Database;
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export interface DeleteAgentSessionRequest {
  authorization?: SessionActionAuthorization | undefined;
  bindings: ApiBindings;
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

const ARCHIVED_RUN_ERROR = {
  code: "session.archived",
  details: {},
  message: "Session was archived before the run completed.",
  retryable: false,
} as const;

function ensureLifecycleActionCapability(input: {
  action: AgentSessionActionCapabilityName;
  authorization?: SessionActionAuthorization | undefined;
  session: SessionParticipantCapabilityAccessRow;
}): void {
  getAvailableAgentSessionActionCapability({
    action: input.action,
    archivedAt: input.session.archived_at,
    isSessionCreator: resolveSessionActionCreatorFlag({
      authorization: input.authorization,
      isSessionCreator: input.session.is_session_creator === 1,
    }),
    runtimeId: input.session.runtime_id,
    status: input.session.status,
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
    const outcome = await setSystemSessionRunStatus(database, {
      error: ARCHIVED_RUN_ERROR,
      runId,
      status: "cancelled",
    });

    if (outcome.kind === "repair_needed") {
      throw new Error("Session archive left the session lifecycle projection stale.");
    }
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
  authorization,
  bindings,
  appId,
  sessionId,
  viewer,
}: ArchiveAgentSessionRequest): Promise<SessionArchiveCleanupStepOutcome[]> {
  const session = await getAppSessionParticipantCapabilityAccess(bindings.DB, viewer.id, {
    appId,
    sessionId,
  });
  ensureLifecycleActionCapability({
    action: "archive_session",
    authorization,
    session,
  });
  const timestampMs = currentTimestampMs();
  const outcomes: SessionArchiveCleanupStepOutcome[] = [];
  let targets: SessionArchiveCleanupTargets | null = null;

  async function loadRuntimeTargets(): Promise<SessionArchiveCleanupTargets> {
    const sandboxSession =
      (await getAppDatabase(bindings.DB)
        .select({ sandbox_id: sandboxSessionsTable.sandboxId })
        .from(sandboxSessionsTable)
        .where(eq(sandboxSessionsTable.sessionId, sessionId))
        .limit(1)
        .get()) ?? null;

    const liveDriverInstanceIds = await listLiveRuntimeDriverInstanceIdsForSession(
      bindings.DB,
      sessionId,
    );

    return {
      liveDriverInstanceIds,
      sandboxId: sandboxSession?.sandbox_id ?? null,
      sessionId,
    };
  }

  async function executeStep(step: SessionArchiveCleanupStep): Promise<void> {
    switch (step) {
      case "archive_session_row": {
        await getAppDatabase(bindings.DB)
          .update(sessionsTable)
          .set({
            archivedAt: timestampMs,
            updatedAt: timestampMs,
          })
          .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.appId, appId)))
          .run();
        return;
      }
      case "close_viewer_sockets": {
        await closeSessionViewerSockets(bindings, sessionId, "session.archived");
        return;
      }
      case "load_runtime_targets": {
        targets = await loadRuntimeTargets();
        return;
      }
      case "stop_live_drivers": {
        await Promise.all(
          requireArchiveCleanupTargets(targets).liveDriverInstanceIds.map((driverInstanceId) =>
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
        return;
      }
      case "normalize_runtime_lifecycle": {
        await normalizeSessionRuntimeLifecycle(bindings.DB, sessionId);
        return;
      }
      case "close_sandbox_session": {
        const cleanupTargets = requireArchiveCleanupTargets(targets);
        if (cleanupTargets.sandboxId === null) {
          return;
        }

        await closeSandboxConversationSession(bindings, {
          sandboxId: cleanupTargets.sandboxId,
          sessionId,
        });
        return;
      }
      default: {
        throw new Error("Unknown session archive cleanup step.");
      }
    }
  }

  for (const step of SESSION_ARCHIVE_CLEANUP_STEPS) {
    if (
      targets !== null &&
      shouldSkipSessionArchiveCleanupStep({
        step,
        targets,
      })
    ) {
      outcomes.push(skipSessionArchiveCleanupStep(step));
      continue;
    }

    await executeStep(step);
    outcomes.push(completeSessionArchiveCleanupStep(step));
  }

  return outcomes;
}

function requireArchiveCleanupTargets(
  targets: SessionArchiveCleanupTargets | null,
): SessionArchiveCleanupTargets {
  if (targets === null) {
    throw new Error("Session archive cleanup targets have not been loaded.");
  }

  return targets;
}

export async function unarchiveAgentSession({
  authorization,
  database,
  appId,
  sessionId,
  viewer,
}: UnarchiveAgentSessionRequest): Promise<void> {
  const session = await getAppSessionParticipantCapabilityAccess(database, viewer.id, {
    appId,
    sessionId,
  });
  ensureLifecycleActionCapability({
    action: "unarchive_session",
    authorization,
    session,
  });

  await normalizeSessionRuntimeLifecycle(database, sessionId);

  await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      archivedAt: null,
      updatedAt: currentTimestampMs(),
    })
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.appId, appId)))
    .run();
}

export async function deleteAgentSession({
  authorization,
  bindings,
  appId,
  sessionId,
  viewer,
}: DeleteAgentSessionRequest): Promise<void> {
  const session = await getAppSessionParticipantCapabilityAccess(bindings.DB, viewer.id, {
    appId,
    sessionId,
  });
  ensureLifecycleActionCapability({
    action: "delete_session",
    authorization,
    session,
  });

  await deleteSessionCascade(bindings, sessionId);
}
