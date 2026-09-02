import type { AgentSessionActionCapabilityName } from "@mosoo/contracts/session";
import { sandboxSessionsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ProjectId, RuntimeOperationId, SessionId, SessionRunId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { recordCanonicalSessionRunTerminal } from "../../runtime/application/session-runs/session-run-terminal-failure.service";
import { assertCanonicalTerminalSessionRunProjection } from "../../runtime/application/session-runs/terminal-run-reconciliation.service";
import {
  ACTIVE_SESSION_RUN_STATUSES,
  isTerminalSessionRunStatus,
} from "../../runtime/domain/session-run-lifecycle.machine";
import { listLiveDriverInstanceRefsForSandboxSessions } from "../../runtime/infrastructure/driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../../runtime/infrastructure/driver-session-stop.service";
import { closeSandboxConversationSession } from "../../runtime/infrastructure/sandbox-session.service";
import {
  cattleTerminalCheckpointReadyPredicate,
  isCattleTerminalCheckpointReadyForNextRun,
} from "../../runtime/infrastructure/session-runs/session-run-admission.repository";
import { getSessionRunSummary } from "../../runtime/infrastructure/session-runs/session-run-store.repository";
import type {
  SessionActionAuthorization,
  SessionParticipantCapabilityAccessRow,
} from "../domain/session-access.policy";
import {
  getProjectSessionParticipantCapabilityAccess,
  lookupProjectSessionParticipantCapabilityAccess,
  resolveSessionActionCreatorFlag,
} from "../domain/session-access.policy";
import { SESSION_ARCHIVE_CLEANUP_STEPS } from "../domain/session-cleanup-plan";
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
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export interface UnarchiveAgentSessionRequest {
  authorization?: SessionActionAuthorization | undefined;
  database: D1Database;
  projectId: ProjectId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export interface DeleteAgentSessionRequest {
  authorization?: SessionActionAuthorization | undefined;
  bindings: ApiBindings;
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

interface SessionArchiveCleanupClaim {
  readonly operationId: RuntimeOperationId;
  readonly timestampMs: number;
}

async function readCurrentSessionArchiveCleanupClaim(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionArchiveCleanupClaim | null> {
  const row = await getAppDatabase(database)
    .select({
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      operationId: sessionsTable.statusOperationId,
      timestampMs: sessionsTable.archivedAt,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1)
    .get();

  return row?.cleanupOperationKind !== "archive" ||
    row.operationId === null ||
    row.timestampMs === null
    ? null
    : { operationId: row.operationId, timestampMs: row.timestampMs };
}

async function claimSessionArchiveCleanup(
  bindings: ApiBindings,
  input: {
    readonly projectId: ProjectId;
    readonly sessionId: SessionId;
  },
): Promise<SessionArchiveCleanupClaim | null> {
  const db = getAppDatabase(bindings.DB);
  const current = await db
    .select({
      archivedAt: sessionsTable.archivedAt,
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      operationId: sessionsTable.statusOperationId,
      provisioningOperationId: sessionsTable.runtimeProvisioningOperationId,
      status: sessionsTable.status,
      statusSeq: sessionsTable.statusSeq,
      updatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)))
    .limit(1)
    .get();
  if (current === undefined) {
    throw new Error("Session was not found while claiming archive cleanup.");
  }
  if (current.provisioningOperationId !== null) {
    throw new Error("Session runtime provisioning is still in progress.");
  }
  if (current.cleanupOperationKind === "archive") {
    if (current.archivedAt === null) {
      throw new Error("Session archive cleanup has an incomplete durable claim.");
    }
    if (current.operationId === null) {
      return null;
    }
    return { operationId: current.operationId, timestampMs: current.archivedAt };
  }
  const isLegacyArchive =
    current.archivedAt !== null &&
    current.cleanupOperationKind === null &&
    (current.operationId === null || current.status !== "TERMINATED");
  if (current.cleanupOperationKind !== null || (current.operationId !== null && !isLegacyArchive)) {
    throw new Error("Session is owned by another lifecycle operation.");
  }
  if (!(await isCattleTerminalCheckpointReadyForNextRun(bindings.DB, input.sessionId))) {
    throw new Error("Session archive is waiting for its completed Run checkpoint.");
  }

  const operationId = createPlatformId<RuntimeOperationId>();
  const timestampMs = current.archivedAt ?? currentTimestampMs();
  const updatedAt = Math.max(currentTimestampMs(), current.updatedAt + 1);
  const claimed = await db
    .update(sessionsTable)
    .set({
      archivedAt: timestampMs,
      cleanupOperationKind: "archive",
      status: "RESCHEDULING",
      statusOperationId: operationId,
      statusSeq: sql`${sessionsTable.statusSeq} + 1`,
      updatedAt,
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        eq(sessionsTable.projectId, input.projectId),
        current.archivedAt === null
          ? isNull(sessionsTable.archivedAt)
          : eq(sessionsTable.archivedAt, current.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        current.operationId === null
          ? isNull(sessionsTable.statusOperationId)
          : eq(sessionsTable.statusOperationId, current.operationId),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        eq(sessionsTable.status, current.status),
        eq(sessionsTable.statusSeq, current.statusSeq),
        eq(sessionsTable.updatedAt, current.updatedAt),
        cattleTerminalCheckpointReadyPredicate(db),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();
  if (claimed !== undefined) {
    return { operationId, timestampMs };
  }

  const winner = await readCurrentSessionArchiveCleanupClaim(bindings.DB, input.sessionId);
  if (winner !== null) {
    return winner;
  }

  if (!(await isCattleTerminalCheckpointReadyForNextRun(bindings.DB, input.sessionId))) {
    throw new Error("Session archive is waiting for its completed Run checkpoint.");
  }

  throw new Error("Session archive cleanup lost its admission race.");
}

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

async function terminalizeActiveSessionRunsForLifecycle(
  bindings: ApiBindings,
  sessionId: SessionId,
  timestampMs: number,
  operationId: RuntimeOperationId,
): Promise<void> {
  const activeRunIds = await listActiveSessionRunIds(bindings.DB, sessionId);

  if (activeRunIds.length > 1) {
    throw new Error("Session archive found more than one active Session Run.");
  }

  for (const runId of activeRunIds) {
    const outcome = await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: ARCHIVED_RUN_ERROR,
      expectedSessionOperationId: operationId,
      lifecycle: "IDLE",
      runId,
      sessionId,
      source: "runtime_operation",
      status: "cancelled",
      timestampMs,
    });

    if (
      outcome.kind === "stale" &&
      !["cancelled", "completed", "expired", "failed"].includes(outcome.run.status)
    ) {
      throw new Error("Session archive lost ownership of its active Session Run.");
    }
  }
}

async function normalizeSessionRuntimeLifecycle(
  bindings: ApiBindings,
  sessionId: SessionId,
  timestampMs: number,
  operationId: RuntimeOperationId,
): Promise<void> {
  await terminalizeActiveSessionRunsForLifecycle(bindings, sessionId, timestampMs, operationId);

  await getAppDatabase(bindings.DB)
    .update(sessionsTable)
    .set({
      status: "IDLE",
      statusSeq: sql`${sessionsTable.statusSeq} + 1`,
      updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${timestampMs})`,
    })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        eq(sessionsTable.status, "RESCHEDULING"),
        eq(sessionsTable.statusOperationId, operationId),
      ),
    )
    .run();

  const projection = await getAppDatabase(bindings.DB)
    .select({
      lastRunId: sessionsTable.lastRunId,
      operationId: sessionsTable.statusOperationId,
      status: sessionsTable.status,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1)
    .get();
  if (
    projection === undefined ||
    projection.operationId !== operationId ||
    projection.status !== "IDLE"
  ) {
    throw new Error("Session archive cleanup lost its lifecycle ownership.");
  }
  if (projection.lastRunId === null) {
    return;
  }
  const lastRun = await getSessionRunSummary(bindings.DB, projection.lastRunId);
  if (lastRun === null || !isTerminalSessionRunStatus(lastRun.status)) {
    throw new Error("Session archive cleanup did not reach a terminal current Run.");
  }
  await assertCanonicalTerminalSessionRunProjection(bindings, {
    runId: lastRun.id,
    sessionId,
    status: lastRun.status,
  });
}

export async function archiveAgentSession({
  authorization,
  bindings,
  projectId,
  sessionId,
  viewer,
}: ArchiveAgentSessionRequest): Promise<SessionArchiveCleanupStepOutcome[]> {
  const session = await getProjectSessionParticipantCapabilityAccess(bindings.DB, viewer.id, {
    projectId,
    sessionId,
  });
  const existingClaim = await readCurrentSessionArchiveCleanupClaim(bindings.DB, sessionId);
  if (existingClaim === null && session.archived_at === null) {
    ensureLifecycleActionCapability({
      action: "archive_session",
      authorization,
      session,
    });
  }
  const claim =
    existingClaim ?? (await claimSessionArchiveCleanup(bindings, { projectId, sessionId }));
  if (claim === null) {
    return [];
  }
  return executeSessionArchiveCleanup(bindings, { projectId, claim, sessionId });
}

async function executeSessionArchiveCleanup(
  bindings: ApiBindings,
  input: {
    readonly projectId: ProjectId;
    readonly claim: SessionArchiveCleanupClaim;
    readonly sessionId: SessionId;
  },
): Promise<SessionArchiveCleanupStepOutcome[]> {
  const { projectId, sessionId } = input;
  const { operationId, timestampMs } = input.claim;
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

    const liveDriverInstances = await listLiveDriverInstanceRefsForSandboxSessions(bindings.DB, [
      sessionId,
    ]);

    return {
      liveDriverInstances,
      sandboxId: sandboxSession?.sandbox_id ?? null,
    };
  }

  async function executeStep(step: SessionArchiveCleanupStep): Promise<void> {
    const owned = await getAppDatabase(bindings.DB)
      .update(sessionsTable)
      .set({ updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${currentTimestampMs()})` })
      .where(
        and(
          eq(sessionsTable.id, sessionId),
          eq(sessionsTable.projectId, projectId),
          eq(sessionsTable.archivedAt, timestampMs),
          eq(sessionsTable.cleanupOperationKind, "archive"),
          eq(sessionsTable.statusOperationId, operationId),
          inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
        ),
      )
      .returning({ id: sessionsTable.id })
      .get();
    if (owned === undefined) {
      throw new Error("Session archive cleanup lost its operation ownership.");
    }

    switch (step) {
      case "archive_session_row": {
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
        const stopOutcomes = await Promise.allSettled(
          requireArchiveCleanupTargets(targets).liveDriverInstances.map((driver) =>
            stopDriverSession(bindings, {
              driverInstanceId: driver.id,
              expectedDriverGeneration: driver.generation,
              reason: "session.archived",
            }),
          ),
        );
        const failure = stopOutcomes.find(
          (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
        );
        if (failure !== undefined) {
          throw failure.reason;
        }
        return;
      }
      case "normalize_runtime_lifecycle": {
        await normalizeSessionRuntimeLifecycle(bindings, sessionId, timestampMs, operationId);
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
      case "complete_archive_session": {
        const completed = await getAppDatabase(bindings.DB)
          .update(sessionsTable)
          .set({
            archivedAt: timestampMs,
            cleanupOperationKind: "archive",
            status: "IDLE",
            statusOperationId: null,
            statusSeq: sql`${sessionsTable.statusSeq} + 1`,
            updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${timestampMs})`,
          })
          .where(
            and(
              eq(sessionsTable.id, sessionId),
              eq(sessionsTable.projectId, projectId),
              eq(sessionsTable.archivedAt, timestampMs),
              eq(sessionsTable.cleanupOperationKind, "archive"),
              eq(sessionsTable.status, "IDLE"),
              eq(sessionsTable.statusOperationId, operationId),
            ),
          )
          .returning({ id: sessionsTable.id })
          .get();
        if (completed === undefined) {
          throw new Error("Session archive cleanup lost its operation ownership.");
        }
        return;
      }
      default: {
        throw new Error("Unknown session archive cleanup step.");
      }
    }
  }

  function shouldSkipStep(step: SessionArchiveCleanupStep): boolean {
    if (targets === null) {
      return false;
    }
    return (
      (step === "close_sandbox_session" && targets.sandboxId === null) ||
      (step === "stop_live_drivers" && targets.liveDriverInstances.length === 0)
    );
  }

  for (const step of SESSION_ARCHIVE_CLEANUP_STEPS) {
    if (shouldSkipStep(step)) {
      outcomes.push({ status: "skipped", step });
      continue;
    }

    await executeStep(step);
    outcomes.push({ status: "completed", step });
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

export async function repairStaleSessionArchiveCleanups(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
    readonly staleUpdatedAtLte: number;
  },
): Promise<number> {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Session archive cleanup repair limit must be a positive integer.");
  }

  const rows = await getAppDatabase(bindings.DB)
    .select({
      projectId: sessionsTable.projectId,
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      operationId: sessionsTable.statusOperationId,
      sessionId: sessionsTable.id,
      status: sessionsTable.status,
      statusSeq: sessionsTable.statusSeq,
      timestampMs: sessionsTable.archivedAt,
      updatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .where(
      and(
        isNotNull(sessionsTable.archivedAt),
        or(
          and(
            eq(sessionsTable.cleanupOperationKind, "archive"),
            inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
            isNotNull(sessionsTable.statusOperationId),
          ),
          and(
            isNull(sessionsTable.cleanupOperationKind),
            or(isNull(sessionsTable.statusOperationId), ne(sessionsTable.status, "TERMINATED")),
          ),
        ),
        lte(sessionsTable.updatedAt, input.staleUpdatedAtLte),
      ),
    )
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(input.limit)
    .all();
  const candidates: Array<{
    projectId: ProjectId;
    claim: SessionArchiveCleanupClaim;
    sessionId: SessionId;
  }> = [];
  for (const row of rows) {
    if (row.timestampMs === null) {
      continue;
    }
    if (row.cleanupOperationKind === null) {
      const claim = await claimSessionArchiveCleanup(bindings, {
        projectId: row.projectId,
        sessionId: row.sessionId,
      });
      if (claim !== null) {
        candidates.push({ projectId: row.projectId, claim, sessionId: row.sessionId });
      }
      continue;
    }
    if (row.operationId === null) {
      continue;
    }

    const attemptAt = Math.max(currentTimestampMs(), row.updatedAt + 1);
    const claimed = await getAppDatabase(bindings.DB)
      .update(sessionsTable)
      .set({ updatedAt: attemptAt })
      .where(
        and(
          eq(sessionsTable.id, row.sessionId),
          eq(sessionsTable.archivedAt, row.timestampMs),
          eq(sessionsTable.cleanupOperationKind, "archive"),
          eq(sessionsTable.status, row.status),
          eq(sessionsTable.statusOperationId, row.operationId),
          eq(sessionsTable.statusSeq, row.statusSeq),
          eq(sessionsTable.updatedAt, row.updatedAt),
        ),
      )
      .returning({ id: sessionsTable.id })
      .get();
    if (claimed !== undefined) {
      candidates.push({
        projectId: row.projectId,
        claim: { operationId: row.operationId, timestampMs: row.timestampMs },
        sessionId: row.sessionId,
      });
    }
  }

  await Promise.allSettled(
    candidates.map(async (candidate) => {
      try {
        await executeSessionArchiveCleanup(bindings, candidate);
      } catch (error) {
        await getAppDatabase(bindings.DB)
          .update(sessionsTable)
          .set({ updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${currentTimestampMs()})` })
          .where(
            and(
              eq(sessionsTable.id, candidate.sessionId),
              eq(sessionsTable.cleanupOperationKind, "archive"),
              eq(sessionsTable.statusOperationId, candidate.claim.operationId),
            ),
          )
          .run();
        logWarn("session.archive_cleanup.repair_failed", {
          ...createErrorLogContext(error),
          operationId: candidate.claim.operationId,
          sessionId: candidate.sessionId,
        });
      }
    }),
  );

  return candidates.length;
}

export async function unarchiveAgentSession({
  authorization,
  database,
  projectId,
  sessionId,
  viewer,
}: UnarchiveAgentSessionRequest): Promise<void> {
  const session = await getProjectSessionParticipantCapabilityAccess(database, viewer.id, {
    projectId,
    sessionId,
  });
  ensureLifecycleActionCapability({
    action: "unarchive_session",
    authorization,
    session,
  });

  if (session.archived_at === null) {
    throw new Error("Session is not archived.");
  }
  const unarchived = await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      archivedAt: null,
      cleanupOperationKind: null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        eq(sessionsTable.projectId, projectId),
        eq(sessionsTable.archivedAt, session.archived_at),
        eq(sessionsTable.cleanupOperationKind, "archive"),
        eq(sessionsTable.status, "IDLE"),
        isNull(sessionsTable.statusOperationId),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();
  if (unarchived === undefined) {
    throw new Error("Session cleanup is still in progress.");
  }
}

export async function deleteAgentSession({
  authorization,
  bindings,
  projectId,
  sessionId,
  viewer,
}: DeleteAgentSessionRequest): Promise<void> {
  const lookup = await lookupProjectSessionParticipantCapabilityAccess(bindings.DB, viewer.id, {
    projectId,
    sessionId,
  });

  // Delete must stay idempotent: clients can hold a session id that was
  // already removed (stale tab, replaced preview session). Treat the missing
  // row as deleted instead of reporting a permission error.
  if (lookup.kind === "missing") {
    return;
  }

  if (lookup.kind === "not_participant") {
    throw forbiddenError();
  }

  ensureLifecycleActionCapability({
    action: "delete_session",
    authorization,
    session: lookup.row,
  });

  await deleteSessionCascade(bindings, sessionId);
}
