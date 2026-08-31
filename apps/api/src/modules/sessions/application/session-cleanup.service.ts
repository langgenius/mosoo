import { getSessionOrganizationPath } from "@mosoo/agent-driver/paths";
import {
  driverInstancesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SessionId, SessionRunId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, exists, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { fileStore } from "../../files/application/file-store";
import { recordCanonicalSessionRunTerminal } from "../../runtime/application/session-runs/session-run-terminal-failure.service";
import { assertCanonicalTerminalSessionRunProjection } from "../../runtime/application/session-runs/terminal-run-reconciliation.service";
import {
  ACTIVE_SESSION_RUN_STATUSES,
  isTerminalSessionRunStatus,
} from "../../runtime/domain/session-run-lifecycle.machine";
import { destroyDriverInstanceDurableObject } from "../../runtime/infrastructure/driver-instance/client";
import { listLiveDriverInstanceRefsForSandboxSessions } from "../../runtime/infrastructure/driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../../runtime/infrastructure/driver-session-stop.service";
import { deleteSandboxBackupsForSession } from "../../runtime/infrastructure/sandbox-backup.service";
import { closeSandboxConversationSession } from "../../runtime/infrastructure/sandbox-session.service";
import { getSessionRunSummary } from "../../runtime/infrastructure/session-runs/session-run-store.repository";
import { SESSION_DELETE_CLEANUP_STEPS } from "../domain/session-cleanup-plan";
import type {
  SessionDeleteCleanupStep,
  SessionDeleteCleanupStepOutcome,
  SessionDeleteCleanupTargets,
} from "../domain/session-cleanup-plan";
import { destroySessionDurableObject } from "../infrastructure/session/client";

type AppDatabase = ReturnType<typeof getAppDatabase>;

export interface SessionDeleteCleanupRepairCandidate {
  readonly archivedAt: number;
  readonly cleanupOperationKind: "delete" | null;
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
  readonly status: "IDLE" | "RESCHEDULING" | "TERMINATED";
  readonly statusSeq: number;
  readonly updatedAt: number;
}

export interface DeleteSessionCascadeOptions {
  readonly operationId?: RuntimeOperationId;
}

const DELETED_RUN_ERROR = {
  code: "session.deleted",
  details: {},
  message: "Session was deleted before the run completed.",
  retryable: false,
} as const;

function driverInstancesForSessionCondition(
  db: AppDatabase,
  sessionId: SessionId,
  runIds: readonly SessionRunId[],
): SQL {
  if (runIds.length === 0) {
    return eq(driverInstancesTable.sandboxSessionId, sessionId);
  }

  const runDriverReferenceQuery = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
        inArray(sessionRunsTable.id, runIds),
      ),
    );

  return or(eq(driverInstancesTable.sandboxSessionId, sessionId), exists(runDriverReferenceQuery))!;
}

async function resolveSessionDeleteCleanupOperationId(
  database: D1Database,
  input: {
    readonly operationId?: RuntimeOperationId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeOperationId> {
  const existing =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        cleanup_operation_kind: sessionsTable.cleanupOperationKind,
        operation_id: sessionsTable.statusOperationId,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (
    existing?.operation_id !== null &&
    existing?.operation_id !== undefined &&
    existing.cleanup_operation_kind === "delete" &&
    (existing.status === "IDLE" || existing.status === "RESCHEDULING")
  ) {
    return existing.operation_id;
  }
  if (
    existing?.archived_at !== null &&
    existing?.archived_at !== undefined &&
    existing.cleanup_operation_kind === null &&
    existing.status === "TERMINATED" &&
    existing.operation_id !== null
  ) {
    return existing.operation_id;
  }

  return input.operationId ?? createPlatformId<RuntimeOperationId>();
}

async function admitSessionDeleteCleanup(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly sessionId: SessionId;
    readonly timestampMs: number;
  },
): Promise<number> {
  const row = await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      archivedAt: sql`COALESCE(${sessionsTable.archivedAt}, ${input.timestampMs})`,
      cleanupOperationKind: "delete",
      status: sql`CASE
        WHEN ${sessionsTable.statusOperationId} = ${input.operationId}
          AND ${sessionsTable.status} IN ('IDLE', 'RESCHEDULING')
        THEN ${sessionsTable.status}
        ELSE 'RESCHEDULING'
      END`,
      statusOperationId: input.operationId,
      statusSeq: sql`${sessionsTable.statusSeq} + CASE
        WHEN ${sessionsTable.statusOperationId} = ${input.operationId}
          AND ${sessionsTable.status} IN ('IDLE', 'RESCHEDULING')
        THEN 0
        ELSE 1
      END`,
      updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${input.timestampMs})`,
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        or(
          and(
            eq(sessionsTable.cleanupOperationKind, "delete"),
            eq(sessionsTable.statusOperationId, input.operationId),
            inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
          ),
          and(isNull(sessionsTable.cleanupOperationKind), isNull(sessionsTable.statusOperationId)),
          and(
            eq(sessionsTable.cleanupOperationKind, "archive"),
            eq(sessionsTable.status, "IDLE"),
            isNull(sessionsTable.statusOperationId),
          ),
          and(
            isNotNull(sessionsTable.archivedAt),
            isNull(sessionsTable.cleanupOperationKind),
            eq(sessionsTable.status, "TERMINATED"),
            eq(sessionsTable.statusOperationId, input.operationId),
          ),
        ),
      ),
    )
    .returning({ archivedAt: sessionsTable.archivedAt })
    .get();

  if (row?.archivedAt === null || row?.archivedAt === undefined) {
    throw new Error("Session delete cleanup could not acquire lifecycle ownership.");
  }
  return row.archivedAt;
}

async function listSessionDeleteCleanupRepairCandidates(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly staleUpdatedAtLte: number;
  },
): Promise<SessionDeleteCleanupRepairCandidate[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Session delete cleanup repair limit must be a positive integer.");
  }

  const rows = await getAppDatabase(database)
    .select({
      archivedAt: sessionsTable.archivedAt,
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      operationId: sessionsTable.statusOperationId,
      sessionId: sessionsTable.id,
      status: sessionsTable.status,
      statusSeq: sessionsTable.statusSeq,
      updatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .where(
      and(
        isNotNull(sessionsTable.archivedAt),
        or(
          and(
            eq(sessionsTable.cleanupOperationKind, "delete"),
            inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
          ),
          and(isNull(sessionsTable.cleanupOperationKind), eq(sessionsTable.status, "TERMINATED")),
        ),
        isNotNull(sessionsTable.statusOperationId),
        lte(sessionsTable.updatedAt, input.staleUpdatedAtLte),
      ),
    )
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(input.limit)
    .all();

  return rows.flatMap((row) => {
    if (
      row.archivedAt === null ||
      row.operationId === null ||
      !["IDLE", "RESCHEDULING", "TERMINATED"].includes(row.status) ||
      (row.cleanupOperationKind !== null && row.cleanupOperationKind !== "delete")
    ) {
      return [];
    }
    return [
      {
        archivedAt: row.archivedAt,
        cleanupOperationKind: row.cleanupOperationKind,
        operationId: row.operationId,
        sessionId: row.sessionId,
        status: row.status as "IDLE" | "RESCHEDULING" | "TERMINATED",
        statusSeq: row.statusSeq,
        updatedAt: row.updatedAt,
      },
    ];
  });
}

async function normalizeSessionDeleteRuntimeLifecycle(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly sessionId: SessionId;
    readonly timestampMs: number;
  },
): Promise<void> {
  const activeRuns = await getAppDatabase(bindings.DB)
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.sessionId, input.sessionId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .all();

  if (activeRuns.length > 1) {
    throw new Error("Session delete found more than one active Session Run.");
  }
  const [activeRun] = activeRuns;
  if (activeRun !== undefined) {
    const outcome = await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: DELETED_RUN_ERROR,
      expectedSessionOperationId: input.operationId,
      lifecycle: "IDLE",
      runId: activeRun.id,
      sessionId: input.sessionId,
      source: "runtime_operation",
      status: "cancelled",
      timestampMs: input.timestampMs,
    });
    if (
      outcome.kind === "stale" &&
      !["cancelled", "completed", "expired", "failed"].includes(outcome.run.status)
    ) {
      throw new Error("Session delete lost ownership of its active Session Run.");
    }
  }

  await getAppDatabase(bindings.DB)
    .update(sessionsTable)
    .set({
      status: "IDLE",
      statusSeq: sql`${sessionsTable.statusSeq} + 1`,
      updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${input.timestampMs})`,
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        eq(sessionsTable.status, "RESCHEDULING"),
        eq(sessionsTable.statusOperationId, input.operationId),
      ),
    )
    .run();

  const projection = await getAppDatabase(bindings.DB)
    .select({
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      lastRunId: sessionsTable.lastRunId,
      operationId: sessionsTable.statusOperationId,
      status: sessionsTable.status,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, input.sessionId))
    .limit(1)
    .get();
  if (
    projection === undefined ||
    projection.cleanupOperationKind !== "delete" ||
    projection.operationId !== input.operationId ||
    projection.status !== "IDLE"
  ) {
    throw new Error("Session delete cleanup lost its lifecycle ownership.");
  }
  if (projection.lastRunId === null) {
    return;
  }
  const lastRun = await getSessionRunSummary(bindings.DB, projection.lastRunId);
  if (lastRun === null || !isTerminalSessionRunStatus(lastRun.status)) {
    throw new Error("Session delete cleanup did not reach a terminal current Run.");
  }
  await assertCanonicalTerminalSessionRunProjection(bindings, {
    runId: lastRun.id,
    sessionId: input.sessionId,
    status: lastRun.status,
  });
}

export async function deleteSessionCascade(
  bindings: ApiBindings,
  sessionId: SessionId,
  options: DeleteSessionCascadeOptions = {},
): Promise<SessionDeleteCleanupStepOutcome[]> {
  const timestampMs = currentTimestampMs();
  const sessionCwd = getSessionOrganizationPath(sessionId);
  const db = getAppDatabase(bindings.DB);
  const operationId = await resolveSessionDeleteCleanupOperationId(bindings.DB, {
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    sessionId,
  });
  const outcomes: SessionDeleteCleanupStepOutcome[] = [];
  let cleanupTimestampMs = timestampMs;
  let targets: SessionDeleteCleanupTargets | null = null;

  async function loadCleanupTargets(): Promise<SessionDeleteCleanupTargets> {
    const sandboxSession =
      (await db
        .select({ sandbox_id: sandboxSessionsTable.sandboxId })
        .from(sandboxSessionsTable)
        .where(eq(sandboxSessionsTable.sessionId, sessionId))
        .limit(1)
        .get()) ?? null;

    const liveDriverInstances = await listLiveDriverInstanceRefsForSandboxSessions(bindings.DB, [
      sessionId,
    ]);

    const sessionRuns = await db
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.sessionId, sessionId))
      .all();
    const runIds = sessionRuns.map((row) => row.id);
    const associatedDriverInstanceRows = await db
      .select({ generation: driverInstancesTable.generation, id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(driverInstancesForSessionCondition(db, sessionId, runIds))
      .all();

    return {
      associatedDriverInstances: associatedDriverInstanceRows,
      liveDriverInstances,
      sandboxId: sandboxSession?.sandbox_id ?? null,
    };
  }

  async function executeStep(step: SessionDeleteCleanupStep): Promise<void> {
    if (step !== "archive_session_row") {
      const owned = await db
        .update(sessionsTable)
        .set({ updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${currentTimestampMs()})` })
        .where(
          and(
            eq(sessionsTable.id, sessionId),
            eq(sessionsTable.cleanupOperationKind, "delete"),
            eq(sessionsTable.statusOperationId, operationId),
            inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
          ),
        )
        .returning({ id: sessionsTable.id })
        .get();
      if (owned === undefined) {
        throw new Error("Session delete cleanup lost its operation ownership.");
      }
    }

    switch (step) {
      case "archive_session_row": {
        cleanupTimestampMs = await admitSessionDeleteCleanup(bindings.DB, {
          operationId,
          sessionId,
          timestampMs,
        });
        return;
      }
      case "load_cleanup_targets": {
        targets = await loadCleanupTargets();
        return;
      }
      case "stop_live_drivers": {
        const results = await Promise.allSettled(
          requireCleanupTargets(targets).liveDriverInstances.map((driver) =>
            stopDriverSession(bindings, {
              driverInstanceId: driver.id,
              expectedDriverGeneration: driver.generation,
              reason: "session.deleted",
            }),
          ),
        );
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure !== undefined) {
          throw failure.reason;
        }
        return;
      }
      case "normalize_runtime_lifecycle": {
        await normalizeSessionDeleteRuntimeLifecycle(bindings, {
          operationId,
          sessionId,
          timestampMs: cleanupTimestampMs,
        });
        return;
      }
      case "close_sandbox_session": {
        const cleanupTargets = requireCleanupTargets(targets);
        if (cleanupTargets.sandboxId === null) {
          return;
        }

        await closeSandboxConversationSession(bindings, {
          sandboxId: cleanupTargets.sandboxId,
          sessionId,
        });
        return;
      }
      case "destroy_driver_objects": {
        const results = await Promise.allSettled(
          requireCleanupTargets(targets).associatedDriverInstances.map((driver) =>
            destroyDriverInstanceDurableObject(
              bindings,
              driver.id,
              driver.generation,
              "session.deleted",
            ),
          ),
        );
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure !== undefined) {
          throw failure.reason;
        }
        return;
      }
      case "destroy_session_object": {
        await destroySessionDurableObject(bindings, sessionId, "session.deleted");
        return;
      }
      case "delete_session_backups": {
        const sandboxId = requireCleanupTargets(targets).sandboxId;
        if (sandboxId === null) {
          return;
        }
        await deleteSandboxBackupsForSession(bindings, {
          cwd: sessionCwd,
          operationId,
          sandboxId,
          sessionId,
        });
        return;
      }
      case "delete_session_files": {
        await fileStore.deleteScope(bindings, {
          id: sessionId,
          kind: "session",
        });
        return;
      }
      case "delete_driver_rows": {
        const associatedDriverInstanceIds = requireCleanupTargets(
          targets,
        ).associatedDriverInstances.map((driver) => driver.id);
        if (associatedDriverInstanceIds.length === 0) {
          return;
        }

        await db
          .delete(driverInstancesTable)
          .where(inArray(driverInstancesTable.id, associatedDriverInstanceIds))
          .run();
        return;
      }
      case "delete_session_row": {
        await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).run();
        return;
      }
      default: {
        throw new Error("Unknown session delete cleanup step.");
      }
    }
  }

  function shouldSkipStep(step: SessionDeleteCleanupStep): boolean {
    if (targets === null) {
      return false;
    }
    return (
      (step === "close_sandbox_session" && targets.sandboxId === null) ||
      (step === "stop_live_drivers" && targets.liveDriverInstances.length === 0) ||
      ((step === "delete_driver_rows" || step === "destroy_driver_objects") &&
        targets.associatedDriverInstances.length === 0)
    );
  }

  for (const step of SESSION_DELETE_CLEANUP_STEPS) {
    if (shouldSkipStep(step)) {
      outcomes.push({ status: "skipped", step });
      continue;
    }

    await executeStep(step);
    outcomes.push({ status: "completed", step });
  }

  return outcomes;
}

export async function repairStaleSessionDeleteCleanups(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
    readonly staleUpdatedAtLte: number;
  },
): Promise<number> {
  const observed = await listSessionDeleteCleanupRepairCandidates(bindings.DB, input);
  const candidates: SessionDeleteCleanupRepairCandidate[] = [];
  for (const candidate of observed) {
    const attemptAt = Math.max(currentTimestampMs(), candidate.updatedAt + 1);
    const claimed = await getAppDatabase(bindings.DB)
      .update(sessionsTable)
      .set({
        cleanupOperationKind: "delete",
        status: candidate.status === "TERMINATED" ? "RESCHEDULING" : candidate.status,
        statusSeq:
          candidate.status === "TERMINATED"
            ? sql`${sessionsTable.statusSeq} + 1`
            : sessionsTable.statusSeq,
        updatedAt: attemptAt,
      })
      .where(
        and(
          eq(sessionsTable.id, candidate.sessionId),
          eq(sessionsTable.archivedAt, candidate.archivedAt),
          candidate.cleanupOperationKind === null
            ? isNull(sessionsTable.cleanupOperationKind)
            : eq(sessionsTable.cleanupOperationKind, candidate.cleanupOperationKind),
          eq(sessionsTable.status, candidate.status),
          eq(sessionsTable.statusOperationId, candidate.operationId),
          eq(sessionsTable.statusSeq, candidate.statusSeq),
          eq(sessionsTable.updatedAt, candidate.updatedAt),
        ),
      )
      .returning({ id: sessionsTable.id })
      .get();
    if (claimed !== undefined) {
      candidates.push(candidate);
    }
  }

  await Promise.allSettled(
    candidates.map(async (candidate) => {
      try {
        await deleteSessionCascade(bindings, candidate.sessionId, {
          operationId: candidate.operationId,
        });
      } catch (error) {
        await getAppDatabase(bindings.DB)
          .update(sessionsTable)
          .set({ updatedAt: sql`MAX(${sessionsTable.updatedAt}, ${currentTimestampMs()})` })
          .where(
            and(
              eq(sessionsTable.id, candidate.sessionId),
              eq(sessionsTable.cleanupOperationKind, "delete"),
              eq(sessionsTable.statusOperationId, candidate.operationId),
            ),
          )
          .run();
        logWarn("session.delete_cleanup.repair_failed", {
          ...createErrorLogContext(error),
          operationId: candidate.operationId,
          sessionId: candidate.sessionId,
        });
      }
    }),
  );

  return candidates.length;
}

function requireCleanupTargets(
  targets: SessionDeleteCleanupTargets | null,
): SessionDeleteCleanupTargets {
  if (targets === null) {
    throw new Error("Session delete cleanup targets have not been loaded.");
  }

  return targets;
}
