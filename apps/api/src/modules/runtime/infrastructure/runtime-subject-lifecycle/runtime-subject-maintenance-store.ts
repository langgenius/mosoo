import { SANDBOX_SESSION_STATE_DIR } from "@mosoo/agent-driver/paths";
import {
  driverInstancesTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";
import { and, asc, eq, exists, inArray, isNotNull, isNull, lte, notExists, or } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { RUNTIME_SUBJECT_RECOVERABLE_OPERATION_STATUSES } from "../../domain/runtime-subject-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  activeConversationSessionQuery,
  activeConversationSessionQueryForListedSubject,
  activeSessionRunQueryForListedSubject,
  getRuntimeSubjectInactiveDeadlineSql,
  LIVE_DRIVER_STATUSES,
  liveDriverInstanceQueryForListedSubject,
  runLeaseQuery,
  runLeaseQueryForListedSubject,
  runtimeProvisioningQuery,
  runtimeProvisioningQueryForListedSubject,
} from "./runtime-subject-store-queries";
import type {
  RuntimeSubjectMaintenanceCandidate,
  RuntimeSubjectOperationRepairCandidate,
  RuntimeSubjectOperationLease,
  RuntimeSubjectStatus,
} from "./runtime-subject-store.types";

function isRuntimeSubjectOperationStatus(
  status: RuntimeSubjectStatus,
): status is RuntimeSubjectOperationRepairCandidate["status"] {
  return RUNTIME_SUBJECT_RECOVERABLE_OPERATION_STATUSES.includes(
    status as RuntimeSubjectOperationRepairCandidate["status"],
  );
}

export async function listRuntimeSubjectDriverIds(
  database: D1Database,
  runtimeSubjectId: SandboxId,
  sandboxIncarnation?: number,
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
        ...(sandboxIncarnation === undefined
          ? []
          : [eq(driverInstancesTable.sandboxIncarnation, sandboxIncarnation)]),
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
        or(
          eq(sandboxesTable.kind, "pet"),
          notExists(activeConversationSessionQueryForListedSubject(appDb)),
        ),
        notExists(runLeaseQueryForListedSubject(appDb)),
        notExists(runtimeProvisioningQueryForListedSubject(appDb)),
        isNotNull(sandboxesTable.inactiveDeadlineAt),
        lte(sandboxesTable.inactiveDeadlineAt, input.now),
      ),
    )
    .orderBy(asc(sandboxesTable.inactiveDeadlineAt))
    .limit(input.limit)
    .all();
}

export interface StrandedRuntimeSubjectDeadlineRepairResult {
  readonly cattle: number;
  readonly pet: number;
}

export async function repairStrandedRuntimeSubjectDeadlines(
  database: D1Database,
  input: { readonly now: number },
): Promise<StrandedRuntimeSubjectDeadlineRepairResult> {
  const appDb = getAppDatabase(database);
  const cattle = await appDb
    .update(sandboxesTable)
    .set({
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadlineSql(input.now),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sandboxesTable.status, "active"),
        eq(sandboxesTable.kind, "cattle"),
        isNull(sandboxesTable.inactiveDeadlineAt),
        notExists(activeConversationSessionQueryForListedSubject(appDb)),
        notExists(runLeaseQueryForListedSubject(appDb)),
        notExists(runtimeProvisioningQueryForListedSubject(appDb)),
      ),
    )
    .run();

  // Pets re-arm the idle deadline on run-lease release, but a maintenance
  // failure path that never released — or a driver row already deleted by the
  // 24h retention sweep — leaves the pet active with a NULL deadline forever,
  // invisible to the recycle sweep while its container keeps billing. Repair
  // only clearly reclaimable pets: no live driver, no active subject run, no
  // run lease.
  const pet = await appDb
    .update(sandboxesTable)
    .set({
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadlineSql(input.now),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sandboxesTable.status, "active"),
        eq(sandboxesTable.kind, "pet"),
        isNull(sandboxesTable.inactiveDeadlineAt),
        notExists(liveDriverInstanceQueryForListedSubject(appDb)),
        notExists(activeSessionRunQueryForListedSubject(appDb)),
        notExists(runLeaseQueryForListedSubject(appDb)),
        notExists(runtimeProvisioningQueryForListedSubject(appDb)),
      ),
    )
    .run();

  return {
    cattle: getD1ChangeCount(cattle),
    pet: getD1ChangeCount(pet),
  };
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
      claimExpiresAt: sandboxesTable.claimExpiresAt,
      claimOwner: sandboxesTable.claimOwner,
      incarnation: sandboxesTable.incarnation,
      operationKind: sandboxesTable.operationKind,
      status: sandboxesTable.status,
    })
    .from(sandboxesTable)
    .where(
      and(
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_RECOVERABLE_OPERATION_STATUSES),
        isNotNull(sandboxesTable.statusOperationId),
        isNotNull(sandboxesTable.operationKind),
        or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, input.staleChangedAtLte),
        ),
      ),
    )
    .orderBy(asc(sandboxesTable.statusChangedAt), asc(sandboxesTable.id))
    .limit(input.limit)
    .all();

  return rows.flatMap((row) =>
    row.operationId === null ||
    row.operationKind === null ||
    !isRuntimeSubjectOperationStatus(row.status)
      ? []
      : [
          {
            claimExpiresAt: row.claimExpiresAt,
            claimOwner: row.claimOwner,
            id: row.id,
            incarnation: row.incarnation,
            kind: row.kind,
            operationKind: row.operationKind,
            operationId: row.operationId,
            status: row.status,
          },
        ],
  );
}

export async function claimRuntimeSubjectOperationForRepair(
  database: D1Database,
  input: {
    readonly candidate: RuntimeSubjectOperationRepairCandidate;
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly now: number;
  },
): Promise<RuntimeSubjectOperationLease | null> {
  const row = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sandboxesTable.id, input.candidate.id),
        eq(sandboxesTable.incarnation, input.candidate.incarnation),
        eq(sandboxesTable.operationKind, input.candidate.operationKind),
        eq(sandboxesTable.status, input.candidate.status),
        eq(sandboxesTable.statusOperationId, input.candidate.operationId),
        ...(input.candidate.claimOwner === null
          ? [isNull(sandboxesTable.claimOwner)]
          : [eq(sandboxesTable.claimOwner, input.candidate.claimOwner)]),
        ...(input.candidate.claimExpiresAt === null
          ? [isNull(sandboxesTable.claimExpiresAt)]
          : [eq(sandboxesTable.claimExpiresAt, input.candidate.claimExpiresAt)]),
        or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, input.now),
        ),
      ),
    )
    .returning({ id: sandboxesTable.id })
    .get();

  return row === undefined
    ? null
    : {
        claimExpiresAt: input.claimExpiresAt,
        claimOwner: input.claimOwner,
        incarnation: input.candidate.incarnation,
        kind: input.candidate.operationKind,
        operationId: input.candidate.operationId,
        status: input.candidate.status,
      };
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
          or(
            eq(sandboxesTable.kind, "pet"),
            notExists(activeConversationSessionQuery(appDb, input.runtimeSubjectId)),
          ),
          notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
          notExists(runtimeProvisioningQuery(appDb, input.runtimeSubjectId)),
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
