import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  RuntimeSubjectErrorCode,
  SandboxOperationKind,
  SandboxSubjectKind,
} from "@mosoo/contracts/sandbox";
import {
  driverInstancesTable,
  nativeResumeRefsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  PlatformId,
  ProjectId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  getRuntimeKindPolicy,
  getRuntimeSubjectInactiveDeadline,
} from "../../domain/runtime-kind-policy";
import {
  RUNTIME_SUBJECT_CLAIMABLE_STATUSES,
  toRuntimeSubjectStatusLifecycleEventName,
} from "../../domain/runtime-subject-lifecycle.machine";
import type { RuntimeSubjectOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  activeSessionRunQueryForListedSubject,
  lastBackupTable,
  mapRuntimeSubjectBackup,
  mapReadyRuntimeSubjectBackup,
  readyLastBackupTable,
  runLeaseQuery,
  runtimeProvisioningQuery,
} from "./runtime-subject-store-queries";
import type {
  RuntimeSubjectActivationRecord,
  RuntimeSubjectOperationLease,
  RuntimeSubjectRecord,
  RuntimeSubjectStatus,
} from "./runtime-subject-store.types";

interface RuntimeSubjectQuotaScope {
  readonly agentId: AgentId;
  readonly projectId: ProjectId;
  readonly executionOwnerUserId: AccountId;
}

function runtimeSubjectAccountCapacityPredicate(input: {
  readonly accountConcurrentSandboxLimit: number;
  readonly executionOwnerUserId: AccountId;
  readonly now: number;
}): SQL {
  // ponytail: use the existing status/claim indexes until measured contention
  // justifies durable admission counters.
  return sql`(
    SELECT COUNT(*)
    FROM ${sandboxesTable} AS account_sandbox
    WHERE account_sandbox.owner_account_id = ${input.executionOwnerUserId}
      AND (
        account_sandbox.status IN ('restoring', 'active', 'backing_up', 'destroying')
        OR (
          account_sandbox.claim_owner IS NOT NULL
          AND account_sandbox.claim_expires_at > ${input.now}
        )
      )
  ) < ${input.accountConcurrentSandboxLimit}`;
}

function runtimeSubjectStatusPatch(input: {
  readonly now: number;
  readonly operationKind: SandboxOperationKind | null;
  readonly operationId: RuntimeOperationId | null;
  readonly source: "api" | "maintenance" | "runtime";
  readonly status: RuntimeSubjectStatus;
}) {
  return {
    status: input.status,
    statusChangedAt: input.now,
    statusEvent: toRuntimeSubjectStatusLifecycleEventName(input.status),
    statusOperationId: input.operationId ?? null,
    operationKind: input.operationKind,
    statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
    statusSource: input.source,
    updatedAt: input.now,
  } as const;
}

export async function getRuntimeSubject(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        agentId: sandboxesTable.agentId,
        projectId: sandboxesTable.projectId,
        id: sandboxesTable.id,
        incarnation: sandboxesTable.incarnation,
        kind: sandboxesTable.kind,
        networkConstraintsHash: sandboxesTable.networkConstraintsHash,
        ownerAccountId: sandboxesTable.ownerAccountId,
        status: sandboxesTable.status,
        subjectId: sandboxesTable.subjectId,
        subjectKind: sandboxesTable.subjectKind,
      })
      .from(sandboxesTable)
      .where(eq(sandboxesTable.id, runtimeSubjectId))
      .limit(1)
      .get()) ?? null;

  return row ?? null;
}

export async function getRuntimeSubjectIdByTuple(
  database: D1Database,
  input: {
    readonly kind: AgentKind;
    readonly subjectId: PlatformId;
    readonly subjectKind: SandboxSubjectKind;
  },
): Promise<SandboxId | null> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sandboxesTable.id })
      .from(sandboxesTable)
      .where(
        and(
          eq(sandboxesTable.kind, input.kind),
          eq(sandboxesTable.subjectKind, input.subjectKind),
          eq(sandboxesTable.subjectId, input.subjectId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return row?.id ?? null;
}

export async function ensureRuntimeSubjectId(
  database: D1Database,
  input: {
    readonly agentId: AgentId;
    readonly projectId: ProjectId;
    readonly executionOwnerUserId: AccountId;
    readonly kind: AgentKind;
    readonly now?: number;
    readonly runtimeSubjectId?: SandboxId;
    readonly subjectId: PlatformId;
    readonly subjectKind: SandboxSubjectKind;
  },
): Promise<SandboxId> {
  const existing = await getRuntimeSubjectIdByTuple(database, input);

  if (existing !== null) {
    const record = await getRuntimeSubject(database, existing);
    if (
      record === null ||
      (input.runtimeSubjectId !== undefined && record.id !== input.runtimeSubjectId) ||
      record.agentId !== input.agentId ||
      record.projectId !== input.projectId ||
      record.ownerAccountId !== input.executionOwnerUserId
    ) {
      throw new Error("Runtime subject identity does not match the allocation request.");
    }
    return existing;
  }

  const now = input.now ?? currentTimestampMs();
  const runtimeSubjectId = input.runtimeSubjectId ?? createPlatformId<SandboxId>(now);
  const result = await getAppDatabase(database)
    .insert(sandboxesTable)
    .values({
      agentId: input.agentId,
      projectId: input.projectId,
      bindMountReady: false,
      claimExpiresAt: null,
      claimOwner: null,
      createdAt: now,
      globalMountsJson: "[]",
      id: runtimeSubjectId,
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(getRuntimeKindPolicy(input.kind), now),
      incarnation: 0,
      kind: input.kind,
      ownerAccountId: input.executionOwnerUserId,
      networkConstraintsHash: null,
      operationKind: null,
      status: "cold",
      statusChangedAt: now,
      statusEvent: toRuntimeSubjectStatusLifecycleEventName("cold"),
      statusOperationId: null,
      statusSeq: 0,
      statusSource: "api",
      subjectId: input.subjectId,
      subjectKind: input.subjectKind,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (getD1ChangeCount(result) > 0) {
    return runtimeSubjectId;
  }

  const createdByConcurrentRequest = await getRuntimeSubjectIdByTuple(database, input);

  if (createdByConcurrentRequest === null) {
    throw new Error("Runtime subject could not be allocated.");
  }

  const concurrentRecord = await getRuntimeSubject(database, createdByConcurrentRequest);
  if (
    concurrentRecord === null ||
    (input.runtimeSubjectId !== undefined && concurrentRecord.id !== input.runtimeSubjectId) ||
    concurrentRecord.agentId !== input.agentId ||
    concurrentRecord.projectId !== input.projectId ||
    concurrentRecord.ownerAccountId !== input.executionOwnerUserId
  ) {
    throw new Error("Runtime subject identity does not match the allocation request.");
  }

  return createdByConcurrentRequest;
}

export async function getRuntimeSubjectActivationRecord(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectActivationRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        agentId: sandboxesTable.agentId,
        projectId: sandboxesTable.projectId,
        claimExpiresAt: sandboxesTable.claimExpiresAt,
        claimOwner: sandboxesTable.claimOwner,
        id: sandboxesTable.id,
        incarnation: sandboxesTable.incarnation,
        kind: sandboxesTable.kind,
        lastError: sandboxesTable.lastError,
        lastErrorCode: sandboxesTable.lastErrorCode,
        lastBackupDir: lastBackupTable.dir,
        lastBackupId: lastBackupTable.id,
        lastBackupStatus: lastBackupTable.status,
        lastReadyBackupDir: readyLastBackupTable.dir,
        lastReadyBackupId: readyLastBackupTable.id,
        networkConstraintsHash: sandboxesTable.networkConstraintsHash,
        ownerAccountId: sandboxesTable.ownerAccountId,
        operationId: sandboxesTable.statusOperationId,
        operationKind: sandboxesTable.operationKind,
        status: sandboxesTable.status,
        subjectId: sandboxesTable.subjectId,
        subjectKind: sandboxesTable.subjectKind,
      })
      .from(sandboxesTable)
      .leftJoin(
        lastBackupTable,
        and(
          eq(lastBackupTable.id, sandboxesTable.lastBackupId),
          eq(lastBackupTable.sandboxId, sandboxesTable.id),
        ),
      )
      .leftJoin(
        readyLastBackupTable,
        and(
          eq(readyLastBackupTable.id, sandboxesTable.lastBackupId),
          eq(readyLastBackupTable.sandboxId, sandboxesTable.id),
          eq(readyLastBackupTable.status, "ready"),
        ),
      )
      .where(eq(sandboxesTable.id, runtimeSubjectId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    agentId: row.agentId,
    projectId: row.projectId,
    claimExpiresAt: row.claimExpiresAt,
    claimOwner: row.claimOwner,
    id: row.id,
    incarnation: row.incarnation,
    kind: row.kind,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    lastBackup: mapRuntimeSubjectBackup({
      dir: row.lastBackupDir,
      id: row.lastBackupId,
      status: row.lastBackupStatus,
    }),
    lastReadyBackup: mapReadyRuntimeSubjectBackup({
      dir: row.lastReadyBackupDir,
      id: row.lastReadyBackupId,
    }),
    networkConstraintsHash: row.networkConstraintsHash,
    ownerAccountId: row.ownerAccountId,
    operationId: row.operationId,
    operationKind: row.operationKind,
    status: row.status,
    subjectId: row.subjectId,
    subjectKind: row.subjectKind,
  };
}

export async function claimRuntimeSubjectActivation(
  database: D1Database,
  input: RuntimeSubjectQuotaScope & {
    readonly accountConcurrentSandboxLimit: number;
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly expectedStatus: RuntimeSubjectStatus;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const claimed =
    (await getAppDatabase(database)
      .update(sandboxesTable)
      .set({
        claimExpiresAt: input.claimExpiresAt,
        claimOwner: input.claimOwner,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          eq(sandboxesTable.agentId, input.agentId),
          eq(sandboxesTable.projectId, input.projectId),
          eq(sandboxesTable.ownerAccountId, input.executionOwnerUserId),
          eq(sandboxesTable.status, input.expectedStatus),
          inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
          or(
            isNull(sandboxesTable.claimOwner),
            isNull(sandboxesTable.claimExpiresAt),
            lte(sandboxesTable.claimExpiresAt, input.now),
          ),
          ...(input.expectedStatus === "cold"
            ? [runtimeSubjectAccountCapacityPredicate(input)]
            : []),
        ),
      )
      .returning({ id: sandboxesTable.id })
      .get()) ?? null;

  return Boolean(claimed?.id);
}

export async function preemptRuntimeSubjectActivationClaim(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly expectedClaimExpiresAt: number;
    readonly expectedClaimOwner: string;
    readonly expectedStatus: RuntimeSubjectStatus;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const preempted =
    (await getAppDatabase(database)
      .update(sandboxesTable)
      .set({
        claimExpiresAt: input.claimExpiresAt,
        claimOwner: input.claimOwner,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          eq(sandboxesTable.status, input.expectedStatus),
          inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
          eq(sandboxesTable.claimOwner, input.expectedClaimOwner),
          eq(sandboxesTable.claimExpiresAt, input.expectedClaimExpiresAt),
        ),
      )
      .returning({ id: sandboxesTable.id })
      .get()) ?? null;

  return Boolean(preempted?.id);
}

export async function markRuntimeSubjectRestoring(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly expectedIncarnation: number;
    readonly expectedStatus: "active" | "cold";
    readonly networkConstraintsHash: string;
    readonly operationId: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<RuntimeSubjectOperationLease | null> {
  const now = currentTimestampMs();
  const row = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      incarnation: sql`${sandboxesTable.incarnation} + 1`,
      lastError: null,
      lastErrorCode: null,
      networkConstraintsHash: input.networkConstraintsHash,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        operationKind: "activate",
        source: "api",
        status: "restoring",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        eq(sandboxesTable.incarnation, input.expectedIncarnation),
        isNotNull(sandboxesTable.claimExpiresAt),
        eq(sandboxesTable.status, input.expectedStatus),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
      ),
    )
    .returning({
      claimExpiresAt: sandboxesTable.claimExpiresAt,
      claimOwner: sandboxesTable.claimOwner,
      incarnation: sandboxesTable.incarnation,
      operationId: sandboxesTable.statusOperationId,
    })
    .get();

  return row?.claimExpiresAt === null || row?.claimOwner === null || row?.operationId === null
    ? null
    : {
        claimExpiresAt: row.claimExpiresAt,
        claimOwner: row.claimOwner,
        incarnation: row.incarnation,
        kind: "activate",
        operationId: row.operationId,
        status: "restoring",
      };
}

export async function markRuntimeSubjectActiveDestroying(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly expectedIncarnation: number;
    readonly message: string;
    readonly operationId: RuntimeOperationId;
    readonly provisioningOperationId: RuntimeOperationId;
    readonly provisioningRunId: SessionRunId;
    readonly provisioningSessionId: SessionId;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<RuntimeSubjectOperationLease | null> {
  const now = currentTimestampMs();
  const db = getAppDatabase(database);
  const retirementRuns = alias(sessionRunsTable, "runtime_subject_retirement_run");
  const retirementDrivers = alias(driverInstancesTable, "runtime_subject_retirement_driver");
  const retirementProvisioning = alias(sessionsTable, "runtime_subject_retirement_provisioning");
  const ownedProvisioning = db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.id, input.provisioningSessionId),
        eq(sessionsTable.runtimeProvisioningOperationId, input.provisioningOperationId),
        eq(sessionsTable.runtimeProvisioningRunId, input.provisioningRunId),
        eq(sessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
        or(
          isNull(sessionsTable.runtimeProvisioningSandboxIncarnation),
          eq(sessionsTable.runtimeProvisioningSandboxIncarnation, input.expectedIncarnation),
        ),
      ),
    );
  const otherProvisioning = db
    .select({ id: retirementProvisioning.id })
    .from(retirementProvisioning)
    .where(
      and(
        eq(retirementProvisioning.runtimeProvisioningSandboxId, input.runtimeSubjectId),
        isNotNull(retirementProvisioning.runtimeProvisioningOperationId),
        ne(retirementProvisioning.runtimeProvisioningOperationId, input.provisioningOperationId),
      ),
    );
  const otherRun = db
    .select({ id: retirementRuns.id })
    .from(retirementRuns)
    .innerJoin(retirementDrivers, eq(retirementDrivers.id, retirementRuns.driverInstanceId))
    .where(
      and(
        ne(retirementRuns.id, input.provisioningRunId),
        eq(retirementDrivers.sandboxId, input.runtimeSubjectId),
        eq(retirementDrivers.sandboxIncarnation, input.expectedIncarnation),
        inArray(retirementRuns.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const row = await db
    .update(sandboxesTable)
    .set({
      lastError: input.message,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        operationKind: "activate",
        source: "api",
        status: "destroying",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        eq(sandboxesTable.incarnation, input.expectedIncarnation),
        isNotNull(sandboxesTable.claimExpiresAt),
        eq(sandboxesTable.status, "active"),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
        exists(ownedProvisioning),
        notExists(otherProvisioning),
        notExists(otherRun),
      ),
    )
    .returning({
      claimExpiresAt: sandboxesTable.claimExpiresAt,
      claimOwner: sandboxesTable.claimOwner,
      incarnation: sandboxesTable.incarnation,
      operationId: sandboxesTable.statusOperationId,
    })
    .get();

  return row?.claimExpiresAt === null || row?.claimOwner === null || row?.operationId === null
    ? null
    : {
        claimExpiresAt: row.claimExpiresAt,
        claimOwner: row.claimOwner,
        incarnation: row.incarnation,
        kind: "activate",
        operationId: row.operationId,
        status: "destroying",
      };
}

export async function markRuntimeSubjectRestoreApplied(
  database: D1Database,
  input: {
    readonly backupId: SandboxBackupId;
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      lastRestoreBackupId: input.backupId,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, "activate"),
        eq(sandboxesTable.status, "restoring"),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) === 1;
}

export async function markRuntimeSubjectActive(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly incarnation: number;
    readonly kind: AgentKind;
    readonly networkConstraintsHash: string;
    readonly operationId: RuntimeOperationId | null;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      globalMountsJson: "[]",
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(getRuntimeKindPolicy(input.kind), now),
      lastError: null,
      lastErrorCode: null,
      operationKind: null,
      status: "active",
      statusChangedAt: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusChangedAt}
	          ELSE ${now}
	        END
	      `,
      statusEvent: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusEvent}
	          ELSE ${toRuntimeSubjectStatusLifecycleEventName("active")}
	        END
	      `,
      statusOperationId: null,
      statusSeq: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusSeq}
	          ELSE ${sandboxesTable.statusSeq} + 1
	        END
	      `,
      statusSource: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusSource}
	          ELSE 'api'
	        END
	      `,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        eq(sandboxesTable.incarnation, input.incarnation),
        eq(sandboxesTable.networkConstraintsHash, input.networkConstraintsHash),
        ...(input.operationId === null
          ? [eq(sandboxesTable.status, "active"), isNull(sandboxesTable.statusOperationId)]
          : [
              eq(sandboxesTable.status, "restoring"),
              eq(sandboxesTable.operationKind, "activate"),
              eq(sandboxesTable.statusOperationId, input.operationId),
            ]),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectActivationDestroying(
  database: D1Database,
  input: {
    readonly message: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      lastError: input.message,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.lease.operationId,
        operationKind: "activate",
        source: "api",
        status: "destroying",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, "activate"),
        eq(sandboxesTable.status, "restoring"),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectActivationFailed(
  database: D1Database,
  input: {
    readonly message: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      // Preserve the activation failure even though teardown succeeded. The
      // next activation can diagnose why this cold start was required.
      lastError: input.message,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: null,
        operationKind: null,
        source: "api",
        status: "cold",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, "activate"),
        eq(sandboxesTable.status, "destroying"),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectOperationStarted(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly now?: number;
    readonly operationId: RuntimeOperationId;
    readonly operationKind: Exclude<SandboxOperationKind, "activate">;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
    readonly status?: "backing_up";
  },
): Promise<RuntimeSubjectOperationLease | null> {
  const now = input.now ?? currentTimestampMs();
  const appDb = getAppDatabase(database);
  const claimPredicate = or(
    eq(sandboxesTable.claimOwner, input.claimOwner),
    isNull(sandboxesTable.claimOwner),
    isNull(sandboxesTable.claimExpiresAt),
    lte(sandboxesTable.claimExpiresAt, now),
  );
  const row = await appDb
    .update(sandboxesTable)
    .set({
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      inactiveDeadlineAt: null,
      lastError: null,
      lastErrorCode: null,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        operationKind: input.operationKind,
        source: input.source ?? "api",
        status: "backing_up",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, "active"),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
        claimPredicate,
        notExists(runtimeProvisioningQuery(appDb, input.runtimeSubjectId)),
        notExists(activeSessionRunQueryForListedSubject(appDb)),
        notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
      ),
    )
    .returning({ incarnation: sandboxesTable.incarnation })
    .get();

  return row === undefined
    ? null
    : {
        claimExpiresAt: input.claimExpiresAt,
        claimOwner: input.claimOwner,
        incarnation: row.incarnation,
        kind: input.operationKind,
        operationId: input.operationId,
        status: "backing_up",
      };
}

export async function advanceRuntimeSubjectOperationStatus(
  database: D1Database,
  input: {
    readonly expectedStatus: RuntimeSubjectOperationLease["status"];
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.lease.operationId,
        operationKind: input.lease.kind,
        source: input.source ?? "api",
        status: input.status,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, input.lease.kind),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectCold(
  database: D1Database,
  input: {
    readonly clearBackups: boolean;
    readonly clearNativeResumeRefs?: boolean;
    readonly errorCode?: RuntimeSubjectErrorCode;
    readonly errorMessage?: string;
    readonly expectedStatus: "destroying";
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const backupFields = input.clearBackups
    ? {
        lastBackupId: null,
        lastRestoreBackupId: null,
      }
    : {};

  const results = await runAppDatabaseBatch(database, (appDb) => {
    const ownedOperation = and(
      eq(sandboxesTable.id, input.runtimeSubjectId),
      eq(sandboxesTable.status, input.expectedStatus),
      eq(sandboxesTable.claimOwner, input.lease.claimOwner),
      eq(sandboxesTable.incarnation, input.lease.incarnation),
      eq(sandboxesTable.operationKind, input.lease.kind),
      eq(sandboxesTable.statusOperationId, input.lease.operationId),
    );
    const stillOwned = exists(
      appDb.select({ id: sandboxesTable.id }).from(sandboxesTable).where(ownedOperation),
    );

    return [
      appDb.delete(nativeResumeRefsTable).where(
        and(
          input.clearNativeResumeRefs ? sql`TRUE` : sql`FALSE`,
          stillOwned,
          exists(
            appDb
              .select({ sessionId: sandboxSessionsTable.sessionId })
              .from(sandboxSessionsTable)
              .where(
                and(
                  eq(sandboxSessionsTable.sessionId, nativeResumeRefsTable.sessionId),
                  eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
                  eq(sandboxSessionsTable.sandboxIncarnation, input.lease.incarnation),
                ),
              ),
          ),
        ),
      ),
      appDb
        .update(sandboxSessionsTable)
        .set({ cleanupOperationId: null, status: "closed", updatedAt: now })
        .where(
          and(
            eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
            eq(sandboxSessionsTable.sandboxIncarnation, input.lease.incarnation),
            inArray(sandboxSessionsTable.status, ["active", "cleanup_pending", "error"]),
            stillOwned,
          ),
        ),
      appDb
        .update(sandboxesTable)
        .set({
          ...backupFields,
          claimExpiresAt: null,
          claimOwner: null,
          inactiveDeadlineAt: null,
          lastError: input.errorMessage ?? null,
          lastErrorCode: input.errorCode ?? null,
          ...runtimeSubjectStatusPatch({
            now,
            operationId: null,
            operationKind: null,
            source: input.source ?? "api",
            status: "cold",
          }),
        })
        .where(ownedOperation),
    ];
  });

  return getD1ChangeCount(results[2]) > 0;
}

export async function markRuntimeSubjectOperationRepairNeeded(
  database: D1Database,
  input: {
    readonly errorMessage: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly expectedStatus: RuntimeSubjectOperationLease["status"];
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: now,
      lastError: input.errorMessage,
      lastErrorCode: input.errorCode,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, input.lease.kind),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function renewRuntimeSubjectOperationLease(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: input.claimExpiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.operationKind, input.lease.kind),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function releaseRuntimeSubjectActivationClaim(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly errorMessage: string;
    readonly incarnation: number;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.errorMessage,
      lastErrorCode: input.errorCode,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        eq(sandboxesTable.incarnation, input.incarnation),
        inArray(sandboxesTable.status, ["active", "cold"]),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}
