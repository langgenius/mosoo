import { SANDBOX_SESSION_STATE_DIR } from "@mosoo/agent-driver/paths";
import {
  driverInstancesTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";
import { and, asc, eq, exists, inArray, isNotNull, isNull, lte, notExists, or } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { RUNTIME_SUBJECT_OPERATION_STATUSES } from "../../domain/runtime-subject-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  activeConversationSessionQuery,
  activeConversationSessionQueryForListedSubject,
  LIVE_DRIVER_STATUSES,
  runLeaseQuery,
  runLeaseQueryForListedSubject,
} from "./runtime-subject-store-queries";
import type {
  RuntimeSubjectMaintenanceCandidate,
  RuntimeSubjectOperationRepairCandidate,
  RuntimeSubjectStatus,
} from "./runtime-subject-store.types";

function isRuntimeSubjectOperationStatus(
  status: RuntimeSubjectStatus,
): status is RuntimeSubjectOperationRepairCandidate["status"] {
  return RUNTIME_SUBJECT_OPERATION_STATUSES.includes(
    status as RuntimeSubjectOperationRepairCandidate["status"],
  );
}

export async function closeRuntimeSubjectSessionsForRecycle(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<void> {
  const now = currentTimestampMs();

  await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .update(sandboxSessionsTable)
      .set({
        status: "closed",
        updatedAt: now,
      })
      .where(
        and(
          eq(sandboxSessionsTable.sandboxId, runtimeSubjectId),
          eq(sandboxSessionsTable.status, "active"),
        ),
      ),
    appDb
      .update(sandboxesTable)
      .set({
        updatedAt: now,
      })
      .where(eq(sandboxesTable.id, runtimeSubjectId)),
  ]);
}

export async function listRuntimeSubjectDriverIds(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<DriverInstanceId[]> {
  const appDb = getAppDatabase(database);
  const activeRunLeaseQuery = appDb
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const results = await appDb
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.sandboxId, runtimeSubjectId),
        or(inArray(driverInstancesTable.status, LIVE_DRIVER_STATUSES), exists(activeRunLeaseQuery)),
      ),
    )
    .all();

  return results.map((row) => row.id);
}

export async function listRuntimeSubjectSessionStateTargets(
  database: D1Database,
  input: {
    readonly runtimeSubjectId: SandboxId;
    readonly sessionIds?: readonly SessionId[];
  },
): Promise<string[]> {
  const sessionIds =
    input.sessionIds === undefined ? null : [...new Set(input.sessionIds)].filter(Boolean);

  if (sessionIds !== null && sessionIds.length === 0) {
    return [];
  }

  const results = await getAppDatabase(database)
    .select({ cwd: sandboxSessionsTable.cwd })
    .from(sandboxSessionsTable)
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        ...(sessionIds === null ? [] : [inArray(sandboxSessionsTable.sessionId, sessionIds)]),
      ),
    )
    .all();

  return results.map((row) => `${row.cwd}/${SANDBOX_SESSION_STATE_DIR}`);
}

export async function listInactiveRuntimeSubjects(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly now: number;
  },
): Promise<RuntimeSubjectMaintenanceCandidate[]> {
  const appDb = getAppDatabase(database);

  return appDb
    .select({
      id: sandboxesTable.id,
      kind: sandboxesTable.kind,
    })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.status, "active"),
        notExists(activeConversationSessionQueryForListedSubject(appDb)),
        notExists(runLeaseQueryForListedSubject(appDb)),
        isNotNull(sandboxesTable.inactiveDeadlineAt),
        lte(sandboxesTable.inactiveDeadlineAt, input.now),
      ),
    )
    .orderBy(asc(sandboxesTable.inactiveDeadlineAt))
    .limit(input.limit)
    .all();
}

export async function listStaleRuntimeSubjectOperations(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly staleChangedAtLte: number;
  },
): Promise<RuntimeSubjectOperationRepairCandidate[]> {
  const rows = await getAppDatabase(database)
    .select({
      id: sandboxesTable.id,
      kind: sandboxesTable.kind,
      operationId: sandboxesTable.statusOperationId,
      status: sandboxesTable.status,
    })
    .from(sandboxesTable)
    .where(
      and(
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_OPERATION_STATUSES),
        isNotNull(sandboxesTable.statusOperationId),
        lte(sandboxesTable.statusChangedAt, input.staleChangedAtLte),
      ),
    )
    .orderBy(asc(sandboxesTable.statusChangedAt), asc(sandboxesTable.id))
    .limit(input.limit)
    .all();

  return rows.flatMap((row) =>
    row.operationId === null || !isRuntimeSubjectOperationStatus(row.status)
      ? []
      : [
          {
            id: row.id,
            kind: row.kind,
            operationId: row.operationId,
            status: row.status,
          },
        ],
  );
}

export async function claimInactiveRuntimeSubject(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const appDb = getAppDatabase(database);
  const claimed =
    (await appDb
      .update(sandboxesTable)
      .set({
        claimExpiresAt: input.claimExpiresAt,
        claimOwner: input.claimOwner,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          eq(sandboxesTable.status, "active"),
          notExists(activeConversationSessionQuery(appDb, input.runtimeSubjectId)),
          notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
          isNotNull(sandboxesTable.inactiveDeadlineAt),
          lte(sandboxesTable.inactiveDeadlineAt, input.now),
          or(
            isNull(sandboxesTable.claimOwner),
            isNull(sandboxesTable.claimExpiresAt),
            lte(sandboxesTable.claimExpiresAt, input.now),
          ),
        ),
      )
      .returning({ id: sandboxesTable.id })
      .get()) ?? null;

  return Boolean(claimed?.id);
}

export async function releaseInactiveRuntimeSubjectClaim(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<void> {
  await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
      ),
    )
    .run();
}
