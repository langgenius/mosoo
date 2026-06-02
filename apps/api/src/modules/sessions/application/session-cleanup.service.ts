import {
  driverInstancesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { getSessionOrganizationPath } from "@mosoo/driver-protocol";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SessionId, SessionRunId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, exists, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { deleteFilesForScope } from "../../files/application/file-scope-cleanup.service";
import { listLiveRuntimeDriverInstanceIdsForSession } from "../../runtime/application/runtime-driver-instance-query.service";
import {
  closeSandboxConversationSession,
  deleteSandboxBackupsForDir,
  destroyDriverInstanceDurableObject,
  stopDriverSession,
} from "../../runtime/application/runtime-session-lifecycle.service";
import {
  SESSION_DELETE_CLEANUP_STEPS,
  completeSessionDeleteCleanupStep,
  shouldSkipSessionDeleteCleanupStep,
  skipSessionDeleteCleanupStep,
} from "../domain/session-cleanup-plan";
import type {
  SessionDeleteCleanupStep,
  SessionDeleteCleanupStepOutcome,
  SessionDeleteCleanupTargets,
} from "../domain/session-cleanup-plan";
import { destroySessionDurableObject } from "../infrastructure/session/client";

type AppDatabase = ReturnType<typeof getAppDatabase>;

export interface SessionDeleteCleanupRepairCandidate {
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
}

export interface DeleteSessionCascadeOptions {
  readonly operationId?: RuntimeOperationId;
}

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
        operation_id: sessionsTable.statusOperationId,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (existing?.status === "TERMINATED" && existing.operation_id !== null) {
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
): Promise<void> {
  await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      archivedAt: sql`COALESCE(${sessionsTable.archivedAt}, ${input.timestampMs})`,
      status: "TERMINATED",
      statusOperationId: input.operationId,
      statusSeq: sql`${sessionsTable.statusSeq} + 1`,
      updatedAt: input.timestampMs,
    })
    .where(eq(sessionsTable.id, input.sessionId))
    .run();
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
      operationId: sessionsTable.statusOperationId,
      sessionId: sessionsTable.id,
    })
    .from(sessionsTable)
    .where(
      and(
        isNotNull(sessionsTable.archivedAt),
        eq(sessionsTable.status, "TERMINATED"),
        isNotNull(sessionsTable.statusOperationId),
        lte(sessionsTable.updatedAt, input.staleUpdatedAtLte),
      ),
    )
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(input.limit)
    .all();

  return rows.flatMap((row) =>
    row.operationId === null ? [] : [{ operationId: row.operationId, sessionId: row.sessionId }],
  );
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
  let targets: SessionDeleteCleanupTargets | null = null;

  async function loadCleanupTargets(): Promise<SessionDeleteCleanupTargets> {
    const sandboxSession =
      (await db
        .select({ sandbox_id: sandboxSessionsTable.sandboxId })
        .from(sandboxSessionsTable)
        .where(eq(sandboxSessionsTable.sessionId, sessionId))
        .limit(1)
        .get()) ?? null;

    const liveDriverInstanceIds = await listLiveRuntimeDriverInstanceIdsForSession(
      bindings.DB,
      sessionId,
    );

    const sessionRuns = await db
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.sessionId, sessionId))
      .all();
    const runIds = sessionRuns.map((row) => row.id);
    const associatedDriverInstanceRows = await db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(driverInstancesForSessionCondition(db, sessionId, runIds))
      .all();

    return {
      associatedDriverInstanceIds: associatedDriverInstanceRows.map((row) => row.id),
      liveDriverInstanceIds,
      sandboxId: sandboxSession?.sandbox_id ?? null,
      sessionId,
    };
  }

  async function executeStep(step: SessionDeleteCleanupStep): Promise<void> {
    switch (step) {
      case "archive_session_row": {
        await admitSessionDeleteCleanup(bindings.DB, {
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
        await Promise.all(
          requireCleanupTargets(targets).liveDriverInstanceIds.map((driverInstanceId) =>
            stopDriverSession(bindings, {
              driverInstanceId,
              reason: "session.deleted",
              terminalRun: {
                error: {
                  code: "session.deleted",
                  details: {},
                  message: "Session was deleted before the run completed.",
                  retryable: false,
                },
                status: "cancelled",
              },
            }),
          ),
        );
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
        await Promise.all(
          requireCleanupTargets(targets).liveDriverInstanceIds.map((driverInstanceId) =>
            destroyDriverInstanceDurableObject(bindings, driverInstanceId, "session.deleted"),
          ),
        );
        return;
      }
      case "destroy_session_object": {
        await destroySessionDurableObject(bindings, sessionId, "session.deleted");
        return;
      }
      case "delete_session_backups": {
        await deleteSandboxBackupsForDir(bindings, { dir: sessionCwd });
        return;
      }
      case "delete_session_files": {
        await deleteFilesForScope(bindings, {
          scopeId: sessionId,
          scopeKind: "session",
        });
        return;
      }
      case "delete_driver_rows": {
        const associatedDriverInstanceIds =
          requireCleanupTargets(targets).associatedDriverInstanceIds;
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

  for (const step of SESSION_DELETE_CLEANUP_STEPS) {
    if (
      targets !== null &&
      shouldSkipSessionDeleteCleanupStep({
        step,
        targets,
      })
    ) {
      outcomes.push(skipSessionDeleteCleanupStep(step));
      continue;
    }

    await executeStep(step);
    outcomes.push(completeSessionDeleteCleanupStep(step));
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
  const candidates = await listSessionDeleteCleanupRepairCandidates(bindings.DB, input);

  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await deleteSessionCascade(bindings, candidate.sessionId, {
          operationId: candidate.operationId,
        });
      } catch (error) {
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
