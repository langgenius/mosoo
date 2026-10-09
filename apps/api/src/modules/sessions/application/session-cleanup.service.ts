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
import { and, asc, eq, exists, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { fileStore } from "../../files/application/file-store";
import { destroyDriverInstanceDurableObject } from "../../runtime/infrastructure/driver-instance/client";
import { listLiveDriverInstanceIdsForSandboxSessions } from "../../runtime/infrastructure/driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../../runtime/infrastructure/driver-session-stop.service";
import { deleteSandboxBackupsForDir } from "../../runtime/infrastructure/sandbox-backup.service";
import { closeSandboxConversationSession } from "../../runtime/infrastructure/sandbox-session/sandbox-conversation-session.service";
import { previewCleanupCandidatePredicate } from "../infrastructure/preview-retention.repository";
import { destroySessionDurableObject } from "../infrastructure/session/client";

type AppDatabase = ReturnType<typeof getAppDatabase>;

export interface SessionDeleteCleanupRepairCandidate {
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
}

export interface DeleteSessionCascadeOptions {
  readonly operationId?: RuntimeOperationId;
  /** Automatic cleanup must claim expiry atomically with terminal admission. */
  readonly expiredPreviewAtMs?: number;
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
    readonly expiredPreviewAtMs?: number;
  },
): Promise<boolean> {
  const db = getAppDatabase(database);
  const result = await db
    .update(sessionsTable)
    .set({
      archivedAt: sql`COALESCE(${sessionsTable.archivedAt}, ${input.timestampMs})`,
      status: "TERMINATED",
      statusOperationId: input.operationId,
      statusSeq: sql`${sessionsTable.statusSeq} + 1`,
      updatedAt: input.timestampMs,
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        input.expiredPreviewAtMs === undefined
          ? undefined
          : previewCleanupCandidatePredicate(db, input.expiredPreviewAtMs),
      ),
    )
    .run();
  return getD1ChangeCount(result) > 0;
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
): Promise<boolean> {
  const db = getAppDatabase(bindings.DB);
  const operationId = await resolveSessionDeleteCleanupOperationId(bindings.DB, {
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    sessionId,
  });
  const admitted = await admitSessionDeleteCleanup(bindings.DB, {
    operationId,
    sessionId,
    timestampMs: currentTimestampMs(),
    ...(options.expiredPreviewAtMs === undefined
      ? {}
      : { expiredPreviewAtMs: options.expiredPreviewAtMs }),
  });
  if (!admitted) {
    return false;
  }

  const sandboxSession =
    (await db
      .select({ sandbox_id: sandboxSessionsTable.sandboxId })
      .from(sandboxSessionsTable)
      .where(eq(sandboxSessionsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null;
  const liveDriverInstanceIds = await listLiveDriverInstanceIdsForSandboxSessions(bindings.DB, [
    sessionId,
  ]);
  const runIds = (
    await db
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.sessionId, sessionId))
      .all()
  ).map((row) => row.id);
  const associatedDriverInstanceIds = (
    await db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(driverInstancesForSessionCondition(db, sessionId, runIds))
      .all()
  ).map((row) => row.id);

  await Promise.all(
    liveDriverInstanceIds.map((driverInstanceId) =>
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

  if (sandboxSession !== null) {
    await closeSandboxConversationSession(bindings, {
      sandboxId: sandboxSession.sandbox_id,
      sessionId,
    });
  }

  await Promise.all(
    liveDriverInstanceIds.map((driverInstanceId) =>
      destroyDriverInstanceDurableObject(bindings, driverInstanceId, "session.deleted"),
    ),
  );
  await destroySessionDurableObject(bindings, sessionId, "session.deleted");
  await deleteSandboxBackupsForDir(bindings, { dir: getSessionOrganizationPath(sessionId) });
  await fileStore.deleteScope(bindings, {
    id: sessionId,
    kind: "session",
  });

  if (associatedDriverInstanceIds.length > 0) {
    await db
      .delete(driverInstancesTable)
      .where(inArray(driverInstancesTable.id, associatedDriverInstanceIds))
      .run();
  }

  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).run();
  return true;
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

export async function cleanupExpiredPreviewSessions(
  bindings: ApiBindings,
  input: { readonly limit: number; readonly nowMs: number },
): Promise<number> {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Preview cleanup limit must be a positive integer.");
  }
  const db = getAppDatabase(bindings.DB);
  const candidates = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(previewCleanupCandidatePredicate(db, input.nowMs))
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(input.limit)
    .all();
  let deleted = 0;
  for (const candidate of candidates) {
    try {
      const admitted = await deleteSessionCascade(bindings, candidate.id, {
        expiredPreviewAtMs: input.nowMs,
      });
      if (admitted) deleted += 1;
    } catch (error) {
      // The admitted terminal operation remains the existing repair queue's anchor.
      logWarn("session.preview_cleanup.failed", {
        ...createErrorLogContext(error),
        sessionId: candidate.id,
      });
    }
  }
  return deleted;
}
