import type { AgentKind } from "@mosoo/contracts/agent";
import type { RuntimeSubjectErrorCode, SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import { sandboxesTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PlatformId, RuntimeOperationId, SandboxBackupId, SandboxId } from "@mosoo/id";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
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
import {
  lastBackupTable,
  mapRuntimeSubjectBackup,
  mapReadyRuntimeSubjectBackup,
  readyLastBackupTable,
} from "./runtime-subject-store-queries";
import type {
  RuntimeSubjectActivationRecord,
  RuntimeSubjectRecord,
  RuntimeSubjectStatus,
} from "./runtime-subject-store.types";

function runtimeSubjectStatusPatch(input: {
  readonly now: number;
  readonly operationId: RuntimeOperationId | null;
  readonly source: "api" | "maintenance" | "runtime";
  readonly status: RuntimeSubjectStatus;
}) {
  return {
    status: input.status,
    statusChangedAt: input.now,
    statusEvent: toRuntimeSubjectStatusLifecycleEventName(input.status),
    statusOperationId: input.operationId ?? null,
    statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
    statusSource: input.source,
    updatedAt: input.now,
  } as const;
}

function runtimeSubjectStatusOperationCondition(
  operationId: RuntimeOperationId | null | undefined,
): SQL[] {
  if (operationId === undefined) {
    return [];
  }

  return operationId === null
    ? [isNull(sandboxesTable.statusOperationId)]
    : [eq(sandboxesTable.statusOperationId, operationId)];
}

export async function getRuntimeSubject(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        id: sandboxesTable.id,
        kind: sandboxesTable.kind,
        status: sandboxesTable.status,
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
    readonly kind: AgentKind;
    readonly now?: number;
    readonly subjectId: PlatformId;
    readonly subjectKind: SandboxSubjectKind;
  },
): Promise<SandboxId> {
  const existing = await getRuntimeSubjectIdByTuple(database, input);

  if (existing !== null) {
    return existing;
  }

  const now = input.now ?? currentTimestampMs();
  const runtimeSubjectId = createPlatformId<SandboxId>(now);
  const result = await getAppDatabase(database)
    .insert(sandboxesTable)
    .values({
      bindMountReady: false,
      claimExpiresAt: null,
      claimOwner: null,
      createdAt: now,
      globalMountsJson: "[]",
      id: runtimeSubjectId,
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(getRuntimeKindPolicy(input.kind), now),
      kind: input.kind,
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

  return createdByConcurrentRequest;
}

export async function getRuntimeSubjectActivationRecord(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectActivationRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        claimExpiresAt: sandboxesTable.claimExpiresAt,
        claimOwner: sandboxesTable.claimOwner,
        id: sandboxesTable.id,
        kind: sandboxesTable.kind,
        lastError: sandboxesTable.lastError,
        lastErrorCode: sandboxesTable.lastErrorCode,
        lastBackupDir: lastBackupTable.dir,
        lastBackupId: lastBackupTable.id,
        lastBackupStatus: lastBackupTable.status,
        lastReadyBackupDir: readyLastBackupTable.dir,
        lastReadyBackupId: readyLastBackupTable.id,
        status: sandboxesTable.status,
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
    claimExpiresAt: row.claimExpiresAt,
    claimOwner: row.claimOwner,
    id: row.id,
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
    status: row.status,
  };
}

export async function createClaimedColdRuntimeSubjectRecord(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly kind: AgentKind;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly subjectId: PlatformId;
    readonly subjectKind: SandboxSubjectKind;
  },
): Promise<boolean> {
  const result = await getAppDatabase(database)
    .insert(sandboxesTable)
    .values({
      bindMountReady: false,
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      createdAt: input.now,
      globalMountsJson: "[]",
      id: input.runtimeSubjectId,
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(
        getRuntimeKindPolicy(input.kind),
        input.now,
      ),
      kind: input.kind,
      status: "cold",
      statusChangedAt: input.now,
      statusEvent: toRuntimeSubjectStatusLifecycleEventName("cold"),
      statusOperationId: null,
      statusSeq: 0,
      statusSource: "api",
      subjectId: input.subjectId,
      subjectKind: input.subjectKind,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function claimRuntimeSubjectActivation(
  database: D1Database,
  input: {
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
          eq(sandboxesTable.status, input.expectedStatus),
          inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
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
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      lastError: null,
      lastErrorCode: null,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: null,
        source: "api",
        status: "restoring",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        eq(sandboxesTable.status, "cold"),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectRestoreApplied(
  database: D1Database,
  input: {
    readonly backupId: SandboxBackupId;
    readonly claimOwner: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<void> {
  await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      lastRestoreBackupId: input.backupId,
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

export async function markRuntimeSubjectActive(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly kind: AgentKind;
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
        inArray(sandboxesTable.status, ["restoring", "active", "error"]),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectActivationFailed(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly message: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<void> {
  const now = currentTimestampMs();

  await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.message,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: null,
        source: "api",
        status: "error",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        inArray(sandboxesTable.status, ["cold", "restoring", "active", "error"]),
      ),
    )
    .run();
}

export async function markRuntimeSubjectOperationStarted(
  database: D1Database,
  input: {
    readonly claimOwner?: string;
    readonly now?: number;
    readonly operationId?: RuntimeOperationId | null;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<boolean> {
  const now = input.now ?? currentTimestampMs();
  const claimPredicate =
    input.claimOwner === undefined
      ? or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, now),
        )
      : eq(sandboxesTable.claimOwner, input.claimOwner);
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      inactiveDeadlineAt: null,
      lastError: null,
      lastErrorCode: null,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId ?? null,
        source: input.source ?? "api",
        status: input.status,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
        claimPredicate,
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function advanceRuntimeSubjectOperationStatus(
  database: D1Database,
  input: {
    readonly expectedStatus: RuntimeSubjectOperationStatus;
    readonly operationId?: RuntimeOperationId | null;
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
        operationId: input.operationId ?? null,
        source: input.source ?? "api",
        status: input.status,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        ...runtimeSubjectStatusOperationCondition(input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectCold(
  database: D1Database,
  input: {
    readonly clearBackups: boolean;
    readonly expectedStatus: RuntimeSubjectOperationStatus;
    readonly operationId?: RuntimeOperationId | null;
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

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      ...backupFields,
      claimExpiresAt: null,
      claimOwner: null,
      inactiveDeadlineAt: null,
      lastError: null,
      lastErrorCode: null,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId ?? null,
        source: input.source ?? "api",
        status: "cold",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        ...runtimeSubjectStatusOperationCondition(input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectOperationRepairNeeded(
  database: D1Database,
  input: {
    readonly errorMessage: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly expectedStatus: RuntimeSubjectOperationStatus;
    readonly operationId: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.errorMessage,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        source: input.source ?? "maintenance",
        status: input.expectedStatus,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        eq(sandboxesTable.statusOperationId, input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectFailed(
  database: D1Database,
  input: {
    readonly errorMessage: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly expectedStatus?: RuntimeSubjectStatus;
    readonly operationId?: RuntimeOperationId | null;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance" | "runtime";
    readonly status: RuntimeSubjectStatus;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const conditions: SQL[] = [eq(sandboxesTable.id, input.runtimeSubjectId)];

  if (input.expectedStatus !== undefined) {
    conditions.push(eq(sandboxesTable.status, input.expectedStatus));
  }

  if (input.operationId !== undefined) {
    conditions.push(...runtimeSubjectStatusOperationCondition(input.operationId));
  }

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.errorMessage,
      lastErrorCode: input.errorCode,
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId ?? null,
        source: input.source ?? "api",
        status: input.status,
      }),
    })
    .where(and(...conditions))
    .run();

  return getD1ChangeCount(result) > 0;
}
