import {
  driverInstancesTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SandboxId } from "@mosoo/id";
import { and, asc, eq, exists, inArray, isNotNull, isNull, lte, notExists, or } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { RUNTIME_SUBJECT_OPERATION_STATUSES } from "../../domain/runtime-subject-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  activeConversationSessionQuery,
  activeConversationSessionQueryForListedSubject,
  activeSessionRunQueryForListedSubject,
  getRuntimeSubjectInactiveDeadlineSql,
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
        or(
          inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
          exists(activeRunLeaseQuery),
        ),
      ),
    )
    .all();

  return results.map((row) => row.id);
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
    })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.status, "active"),
        eq(sandboxesTable.subjectKind, "session"),
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

export async function repairStrandedRuntimeSubjectDeadlines(
  database: D1Database,
  input: { readonly now: number },
): Promise<number> {
  const appDb = getAppDatabase(database);
  const result = await appDb
    .update(sandboxesTable)
    .set({
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadlineSql(input.now),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sandboxesTable.subjectKind, "session"),
        eq(sandboxesTable.status, "active"),
        isNull(sandboxesTable.inactiveDeadlineAt),
        notExists(activeConversationSessionQueryForListedSubject(appDb)),
        notExists(activeSessionRunQueryForListedSubject(appDb)),
        notExists(runLeaseQueryForListedSubject(appDb)),
      ),
    )
    .run();
  return getD1ChangeCount(result);
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
      operationId: sandboxesTable.statusOperationId,
      status: sandboxesTable.status,
    })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.subjectKind, "session"),
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
          eq(sandboxesTable.subjectKind, "session"),
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
