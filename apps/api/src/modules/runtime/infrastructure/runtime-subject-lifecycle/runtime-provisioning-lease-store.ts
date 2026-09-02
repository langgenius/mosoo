import {
  driverInstancesTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  RuntimeOperationId,
  SandboxId,
  SandboxSessionId,
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
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  ASSIGNABLE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../../domain/driver-instance-lifecycle.machine";
import { toRuntimeSubjectStatusLifecycleEventName } from "../../domain/runtime-subject-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-store.types";

export interface RuntimeProvisioningLease {
  readonly heartbeatAt: number;
  readonly operationId: RuntimeOperationId;
  readonly runId: SessionRunId | null;
  readonly sandboxId: SandboxId;
  readonly sandboxIncarnation: number | null;
  readonly sandboxSessionId: SandboxSessionId | null;
  readonly sessionId: SessionId;
}

export interface RuntimeRunProvisioningLease extends RuntimeProvisioningLease {
  readonly runId: SessionRunId;
}

export interface RuntimeProvisioningCleanupTargets {
  readonly conversationSessionId: SandboxSessionId | null;
  readonly driverInstances: readonly {
    readonly generation: number;
    readonly id: DriverInstanceId;
    readonly status: (typeof driverInstancesTable.$inferSelect)["status"];
  }[];
}

export type RuntimeProvisioningSubjectRetirementOutcome =
  | { readonly kind: "cold" }
  | { readonly kind: "destroying"; readonly lease: RuntimeSubjectOperationLease }
  | { readonly kind: "repairing" }
  | { readonly kind: "stale" }
  | { readonly kind: "waiting" };

const RUNTIME_PROVISIONING_RETIRE_CLAIM_TTL_MS = 30 * 60_000;

function runtimeProvisioningRetireClaimOwner(sessionId: SessionId): string {
  return `runtime-provisioning-retire:${sessionId}`;
}

const otherProvisioningSessionsTable = alias(sessionsTable, "other_runtime_provisioning_session");
const otherProvisioningRunsTable = alias(sessionRunsTable, "other_runtime_provisioning_run");
const otherProvisioningDriversTable = alias(
  driverInstancesTable,
  "other_runtime_provisioning_driver",
);
const retirementOwnerSessionsTable = alias(sessionsTable, "runtime_retirement_owner_session");

/**
 * The durable subject status closes admission. This predicate only decides
 * whether the current worker may advance from draining to physical teardown.
 */
export async function runtimeSubjectActivationRetirementIsDrained(
  database: D1Database,
  input: {
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  if (input.lease.kind !== "activate" || input.lease.status !== "destroying") {
    return true;
  }

  const db = getAppDatabase(database);
  const otherProvisioning = db
    .select({ id: otherProvisioningSessionsTable.id })
    .from(otherProvisioningSessionsTable)
    .where(
      and(
        eq(otherProvisioningSessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
        isNotNull(otherProvisioningSessionsTable.runtimeProvisioningOperationId),
        ne(otherProvisioningSessionsTable.runtimeProvisioningOperationId, input.lease.operationId),
      ),
    );
  const ownedRun = db
    .select({ id: retirementOwnerSessionsTable.id })
    .from(retirementOwnerSessionsTable)
    .where(
      and(
        eq(retirementOwnerSessionsTable.runtimeProvisioningOperationId, input.lease.operationId),
        eq(retirementOwnerSessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
        eq(retirementOwnerSessionsTable.runtimeProvisioningRunId, otherProvisioningRunsTable.id),
      ),
    );
  const otherActiveRun = db
    .select({ id: otherProvisioningRunsTable.id })
    .from(otherProvisioningRunsTable)
    .innerJoin(
      otherProvisioningDriversTable,
      eq(otherProvisioningDriversTable.id, otherProvisioningRunsTable.driverInstanceId),
    )
    .where(
      and(
        eq(otherProvisioningDriversTable.sandboxId, input.runtimeSubjectId),
        eq(otherProvisioningDriversTable.sandboxIncarnation, input.lease.incarnation),
        inArray(otherProvisioningRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        notExists(ownedRun),
      ),
    );
  const drained = await db
    .select({ id: sandboxesTable.id })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.incarnation, input.lease.incarnation),
        eq(sandboxesTable.status, "destroying"),
        eq(sandboxesTable.operationKind, "activate"),
        eq(sandboxesTable.statusOperationId, input.lease.operationId),
        eq(sandboxesTable.claimOwner, input.lease.claimOwner),
        notExists(otherProvisioning),
        notExists(otherActiveRun),
      ),
    )
    .limit(1)
    .get();

  return drained !== undefined;
}

export async function claimRuntimeProvisioningDriverCleanup(
  database: D1Database,
  input: {
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly lease: RuntimeProvisioningLease;
    readonly source: "api" | "maintenance";
  },
): Promise<boolean> {
  if (input.lease.sandboxIncarnation === null) {
    return false;
  }
  const db = getAppDatabase(database);
  const ownedLease = db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(runtimeProvisioningLeaseCondition(input.lease));
  const now = currentTimestampMs();
  const claimed = await db
    .update(driverInstancesTable)
    .set({
      status: "stopping",
      statusChangedAt: now,
      statusEvent: toDriverInstanceStatusLifecycleEventName("stopping"),
      statusOperationId: input.lease.operationId,
      statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
      statusSource: input.source,
      updatedAt: now,
    })
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.sandboxId, input.lease.sandboxId),
        eq(driverInstancesTable.sandboxIncarnation, input.lease.sandboxIncarnation),
        eq(driverInstancesTable.sandboxSessionId, input.lease.sessionId),
        inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_INSTANCE_STATUSES),
        isNull(driverInstancesTable.statusOperationId),
        exists(ownedLease),
      ),
    )
    .returning({ id: driverInstancesTable.id })
    .get();
  if (claimed !== undefined) {
    return true;
  }

  const adopted = await db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.sandboxId, input.lease.sandboxId),
        eq(driverInstancesTable.sandboxIncarnation, input.lease.sandboxIncarnation),
        eq(driverInstancesTable.sandboxSessionId, input.lease.sessionId),
        eq(driverInstancesTable.status, "stopping"),
        eq(driverInstancesTable.statusOperationId, input.lease.operationId),
        exists(ownedLease),
      ),
    )
    .limit(1)
    .get();

  return adopted !== undefined;
}

export async function claimRuntimeRunProvisioningLease(
  database: D1Database,
  input: {
    readonly runId: SessionRunId;
    readonly sandboxId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeRunProvisioningLease | null> {
  const heartbeatAt = currentTimestampMs();
  const operationId = createPlatformId<RuntimeOperationId>();
  const db = getAppDatabase(database);
  const activeRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.id, input.runId),
        eq(sessionRunsTable.sessionId, input.sessionId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const availableSubject = db
    .select({ id: sandboxesTable.id })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.id, input.sandboxId),
        inArray(sandboxesTable.status, ["active", "cold"]),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
        or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, heartbeatAt),
        ),
      ),
    );
  const otherProvisioning = db
    .select({ id: otherProvisioningSessionsTable.id })
    .from(otherProvisioningSessionsTable)
    .where(
      and(
        ne(otherProvisioningSessionsTable.id, input.sessionId),
        eq(otherProvisioningSessionsTable.runtimeProvisioningSandboxId, input.sandboxId),
        isNotNull(otherProvisioningSessionsTable.runtimeProvisioningOperationId),
      ),
    );
  const claimed = await db
    .update(sessionsTable)
    .set({
      runtimeProvisioningHeartbeatAt: heartbeatAt,
      runtimeProvisioningOperationId: operationId,
      runtimeProvisioningRunId: input.runId,
      runtimeProvisioningSandboxId: input.sandboxId,
      runtimeProvisioningSandboxIncarnation: null,
      runtimeProvisioningSandboxSessionId: null,
    })
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        eq(sessionsTable.lastRunId, input.runId),
        eq(sessionsTable.status, "RUNNING"),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        isNull(sessionsTable.statusOperationId),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        exists(activeRun),
        exists(availableSubject),
        notExists(otherProvisioning),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();

  return claimed === undefined
    ? null
    : {
        heartbeatAt,
        operationId,
        runId: input.runId,
        sandboxId: input.sandboxId,
        sandboxIncarnation: null,
        sandboxSessionId: null,
        sessionId: input.sessionId,
      };
}

export async function recordRuntimeProvisioningConversationTarget(
  database: D1Database,
  input: {
    readonly lease: RuntimeRunProvisioningLease;
    readonly sandboxIncarnation: number;
    readonly sandboxSessionId: SandboxSessionId;
  },
): Promise<RuntimeRunProvisioningLease | null> {
  if (
    (input.lease.sandboxIncarnation !== null &&
      input.lease.sandboxIncarnation !== input.sandboxIncarnation) ||
    (input.lease.sandboxSessionId !== null &&
      input.lease.sandboxSessionId !== input.sandboxSessionId)
  ) {
    throw new Error("Runtime provisioning cannot change its immutable conversation target.");
  }

  if (input.lease.sandboxSessionId === input.sandboxSessionId) {
    return input.lease;
  }

  const heartbeatAt = currentTimestampMs();
  const updated = await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      runtimeProvisioningHeartbeatAt: heartbeatAt,
      runtimeProvisioningSandboxIncarnation: input.sandboxIncarnation,
      runtimeProvisioningSandboxSessionId: input.sandboxSessionId,
    })
    .where(runtimeProvisioningLeaseCondition(input.lease))
    .returning({ id: sessionsTable.id })
    .get();

  return updated === undefined
    ? null
    : {
        ...input.lease,
        heartbeatAt,
        sandboxIncarnation: input.sandboxIncarnation,
        sandboxSessionId: input.sandboxSessionId,
      };
}

export async function recordRuntimeProvisioningSandboxIncarnation(
  database: D1Database,
  input: {
    readonly lease: RuntimeRunProvisioningLease;
    readonly sandboxIncarnation: number;
  },
): Promise<RuntimeRunProvisioningLease | null> {
  if (!Number.isSafeInteger(input.sandboxIncarnation) || input.sandboxIncarnation < 0) {
    throw new Error("Runtime provisioning sandbox incarnation must be non-negative.");
  }
  if (
    input.lease.sandboxIncarnation !== null &&
    input.lease.sandboxIncarnation !== input.sandboxIncarnation
  ) {
    throw new Error("Runtime provisioning cannot change its immutable sandbox incarnation.");
  }
  if (input.lease.sandboxIncarnation === input.sandboxIncarnation) {
    return input.lease;
  }

  const heartbeatAt = currentTimestampMs();
  const updated = await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      runtimeProvisioningHeartbeatAt: heartbeatAt,
      runtimeProvisioningSandboxIncarnation: input.sandboxIncarnation,
    })
    .where(runtimeProvisioningLeaseCondition(input.lease))
    .returning({ id: sessionsTable.id })
    .get();
  return updated === undefined
    ? null
    : {
        ...input.lease,
        heartbeatAt,
        sandboxIncarnation: input.sandboxIncarnation,
      };
}

/** Poison N durably first; the expiring claim only elects its teardown worker. */
export async function claimRuntimeProvisioningSubjectRetirement(
  database: D1Database,
  input: {
    readonly lease: RuntimeProvisioningLease;
    readonly source: "api" | "maintenance";
  },
): Promise<RuntimeProvisioningSubjectRetirementOutcome> {
  const { lease } = input;
  if (lease.sandboxIncarnation === null) {
    return { kind: "stale" };
  }

  const now = currentTimestampMs();
  const claimExpiresAt = now + RUNTIME_PROVISIONING_RETIRE_CLAIM_TTL_MS;
  const claimOwner = runtimeProvisioningRetireClaimOwner(lease.sessionId);
  const db = getAppDatabase(database);
  const ownedLease = db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(runtimeProvisioningLeaseCondition(lease));

  await db
    .update(sandboxesTable)
    .set({
      claimExpiresAt,
      claimOwner,
      lastError: "Runtime provisioning left an ambiguous physical mutation.",
      lastErrorCode: "runtime.subject_activation_failed",
      operationKind: "activate",
      status: "destroying",
      statusChangedAt: now,
      statusEvent: toRuntimeSubjectStatusLifecycleEventName("destroying"),
      statusOperationId: lease.operationId,
      statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
      statusSource: input.source,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, lease.sandboxId),
        eq(sandboxesTable.incarnation, lease.sandboxIncarnation),
        eq(sandboxesTable.status, "active"),
        isNull(sandboxesTable.operationKind),
        isNull(sandboxesTable.statusOperationId),
        or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, now),
          eq(sandboxesTable.claimOwner, claimOwner),
        ),
        exists(ownedLease),
      ),
    )
    .run();

  // A stale provisioning takeover rotates its operation id. Adopt the durable
  // poison only when no different worker still owns the subject claim.
  await db
    .update(sandboxesTable)
    .set({
      claimExpiresAt,
      claimOwner,
      statusOperationId: lease.operationId,
      statusSource: input.source,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, lease.sandboxId),
        eq(sandboxesTable.incarnation, lease.sandboxIncarnation),
        eq(sandboxesTable.status, "destroying"),
        eq(sandboxesTable.operationKind, "activate"),
        or(
          eq(sandboxesTable.claimOwner, claimOwner),
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, now),
        ),
        exists(ownedLease),
      ),
    )
    .run();

  const state = await db
    .select({
      claimExpiresAt: sandboxesTable.claimExpiresAt,
      claimOwner: sandboxesTable.claimOwner,
      incarnation: sandboxesTable.incarnation,
      operationId: sandboxesTable.statusOperationId,
      operationKind: sandboxesTable.operationKind,
      status: sandboxesTable.status,
    })
    .from(sessionsTable)
    .innerJoin(sandboxesTable, eq(sandboxesTable.id, sessionsTable.runtimeProvisioningSandboxId))
    .where(runtimeProvisioningLeaseCondition(lease))
    .limit(1)
    .get();
  if (state === undefined || state.incarnation !== lease.sandboxIncarnation) {
    return { kind: "stale" };
  }
  if (state.status === "cold") {
    return { kind: "cold" };
  }
  if (
    state.status !== "destroying" ||
    state.operationKind !== "activate" ||
    state.operationId !== lease.operationId ||
    state.claimOwner !== claimOwner ||
    state.claimExpiresAt === null
  ) {
    return state.status === "destroying" && state.operationKind === "activate"
      ? { kind: "repairing" }
      : { kind: "waiting" };
  }

  const operationLease: RuntimeSubjectOperationLease = {
    claimExpiresAt: state.claimExpiresAt,
    claimOwner,
    incarnation: lease.sandboxIncarnation,
    kind: "activate",
    operationId: lease.operationId,
    status: "destroying",
  };
  return (await runtimeSubjectActivationRetirementIsDrained(database, {
    lease: operationLease,
    runtimeSubjectId: lease.sandboxId,
  }))
    ? { kind: "destroying", lease: operationLease }
    : { kind: "waiting" };
}

export async function heartbeatRuntimeRunProvisioningLease(
  database: D1Database,
  lease: RuntimeRunProvisioningLease,
): Promise<boolean> {
  const heartbeatAt = currentTimestampMs();
  const db = getAppDatabase(database);
  const activeRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.id, lease.runId),
        eq(sessionRunsTable.sessionId, lease.sessionId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const updated = await db
    .update(sessionsTable)
    .set({ runtimeProvisioningHeartbeatAt: heartbeatAt })
    .where(
      and(
        runtimeProvisioningLeaseCondition(lease),
        eq(sessionsTable.lastRunId, lease.runId),
        eq(sessionsTable.status, "RUNNING"),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        isNull(sessionsTable.statusOperationId),
        exists(activeRun),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();

  return updated !== undefined;
}

export async function releaseReadyRuntimeRunProvisioningLease(
  database: D1Database,
  input: {
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly lease: RuntimeRunProvisioningLease;
  },
): Promise<boolean> {
  if (input.lease.sandboxIncarnation === null) {
    return false;
  }
  const db = getAppDatabase(database);
  const activeConversation = db
    .select({ id: sandboxSessionsTable.sessionId })
    .from(sandboxSessionsTable)
    .where(
      and(
        eq(sandboxSessionsTable.sessionId, input.lease.sessionId),
        eq(sandboxSessionsTable.sandboxId, input.lease.sandboxId),
        input.lease.sandboxIncarnation === null
          ? isNull(sandboxSessionsTable.sandboxIncarnation)
          : eq(sandboxSessionsTable.sandboxIncarnation, input.lease.sandboxIncarnation),
        input.lease.sandboxSessionId === null
          ? isNull(sandboxSessionsTable.sandboxSessionId)
          : eq(sandboxSessionsTable.sandboxSessionId, input.lease.sandboxSessionId),
        eq(sandboxSessionsTable.status, "active"),
      ),
    );
  const linkedRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.id, input.lease.runId),
        eq(sessionRunsTable.sessionId, input.lease.sessionId),
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const durableDriver = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.sandboxId, input.lease.sandboxId),
        eq(driverInstancesTable.sandboxIncarnation, input.lease.sandboxIncarnation),
        eq(driverInstancesTable.sandboxSessionId, input.lease.sessionId),
        inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_INSTANCE_STATUSES),
        isNull(driverInstancesTable.statusOperationId),
      ),
    );
  const released = await db
    .update(sessionsTable)
    .set(runtimeProvisioningLeaseReleasePatch())
    .where(
      and(
        runtimeProvisioningLeaseCondition(input.lease),
        eq(sessionsTable.lastRunId, input.lease.runId),
        eq(sessionsTable.status, "RUNNING"),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        isNull(sessionsTable.statusOperationId),
        exists(activeConversation),
        exists(linkedRun),
        exists(durableDriver),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();

  return released !== undefined;
}

export async function adoptReadyRuntimeRunProvisioningLease(
  database: D1Database,
  lease: RuntimeProvisioningLease,
): Promise<boolean> {
  if (lease.runId === null || lease.sandboxIncarnation === null) {
    return false;
  }
  const driver = await getAppDatabase(database)
    .select({
      generation: driverInstancesTable.generation,
      id: driverInstancesTable.id,
    })
    .from(sessionRunsTable)
    .innerJoin(driverInstancesTable, eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId))
    .where(
      and(
        eq(sessionRunsTable.id, lease.runId),
        eq(sessionRunsTable.sessionId, lease.sessionId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        eq(driverInstancesTable.sandboxId, lease.sandboxId),
        eq(driverInstancesTable.sandboxIncarnation, lease.sandboxIncarnation),
        eq(driverInstancesTable.sandboxSessionId, lease.sessionId),
        inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_INSTANCE_STATUSES),
        isNull(driverInstancesTable.statusOperationId),
      ),
    )
    .limit(1)
    .get();

  return driver === undefined
    ? false
    : releaseReadyRuntimeRunProvisioningLease(database, {
        driverGeneration: driver.generation,
        driverInstanceId: driver.id,
        lease: { ...lease, runId: lease.runId },
      });
}

export async function releaseAbortedRuntimeProvisioningLease(
  database: D1Database,
  lease: RuntimeProvisioningLease,
): Promise<boolean> {
  const released = await getAppDatabase(database)
    .update(sessionsTable)
    .set(runtimeProvisioningLeaseReleasePatch())
    .where(runtimeProvisioningLeaseCondition(lease))
    .returning({ id: sessionsTable.id })
    .get();

  return released !== undefined;
}

export async function renewRuntimeProvisioningLeaseOwnership(
  database: D1Database,
  lease: RuntimeProvisioningLease,
): Promise<boolean> {
  const renewed = await getAppDatabase(database)
    .update(sessionsTable)
    .set({ runtimeProvisioningHeartbeatAt: currentTimestampMs() })
    .where(runtimeProvisioningLeaseCondition(lease))
    .returning({ id: sessionsTable.id })
    .get();

  return renewed !== undefined;
}

export async function readRuntimeProvisioningCleanupTargets(
  database: D1Database,
  lease: RuntimeProvisioningLease,
): Promise<RuntimeProvisioningCleanupTargets | null> {
  const rows = await getAppDatabase(database)
    .select({
      driverGeneration: driverInstancesTable.generation,
      driverId: driverInstancesTable.id,
      driverStatus: driverInstancesTable.status,
    })
    .from(sessionsTable)
    .leftJoin(
      driverInstancesTable,
      and(
        eq(driverInstancesTable.sandboxSessionId, lease.sessionId),
        eq(driverInstancesTable.sandboxId, lease.sandboxId),
        ...(lease.sandboxIncarnation === null
          ? [sql`0`]
          : [eq(driverInstancesTable.sandboxIncarnation, lease.sandboxIncarnation)]),
      ),
    )
    .where(runtimeProvisioningLeaseCondition(lease))
    .all();

  if (rows.length === 0) {
    return null;
  }

  return {
    conversationSessionId: lease.sandboxSessionId,
    driverInstances: rows.flatMap((row) =>
      row.driverId === null || row.driverGeneration === null || row.driverStatus === null
        ? []
        : [{ generation: row.driverGeneration, id: row.driverId, status: row.driverStatus }],
    ),
  };
}

export async function claimStaleRuntimeProvisioningLeases(
  database: D1Database,
  input: { readonly heartbeatAtLte: number; readonly limit: number },
): Promise<RuntimeProvisioningLease[]> {
  if (!Number.isSafeInteger(input.heartbeatAtLte) || input.heartbeatAtLte < 0) {
    throw new Error("Runtime provisioning stale heartbeat must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Runtime provisioning repair limit must be a positive integer.");
  }
  const db = getAppDatabase(database);
  const rows = await db
    .select({
      heartbeatAt: sessionsTable.runtimeProvisioningHeartbeatAt,
      operationId: sessionsTable.runtimeProvisioningOperationId,
      runId: sessionsTable.runtimeProvisioningRunId,
      sandboxId: sessionsTable.runtimeProvisioningSandboxId,
      sandboxIncarnation: sessionsTable.runtimeProvisioningSandboxIncarnation,
      sandboxSessionId: sessionsTable.runtimeProvisioningSandboxSessionId,
      sessionId: sessionsTable.id,
    })
    .from(sessionsTable)
    .where(
      and(
        isNotNull(sessionsTable.runtimeProvisioningOperationId),
        isNotNull(sessionsTable.runtimeProvisioningSandboxId),
        isNotNull(sessionsTable.runtimeProvisioningHeartbeatAt),
        lte(sessionsTable.runtimeProvisioningHeartbeatAt, input.heartbeatAtLte),
      ),
    )
    .orderBy(sessionsTable.runtimeProvisioningHeartbeatAt, sessionsTable.id)
    .limit(input.limit)
    .all();
  const claims: RuntimeProvisioningLease[] = [];

  for (const row of rows) {
    if (row.heartbeatAt === null || row.operationId === null || row.sandboxId === null) {
      continue;
    }
    const previous: RuntimeProvisioningLease = {
      heartbeatAt: row.heartbeatAt,
      operationId: row.operationId,
      runId: row.runId,
      sandboxId: row.sandboxId,
      sandboxIncarnation: row.sandboxIncarnation,
      sandboxSessionId: row.sandboxSessionId,
      sessionId: row.sessionId,
    };
    const operationId = createPlatformId<RuntimeOperationId>();
    const heartbeatAt = currentTimestampMs();
    const claimed = await db
      .update(sessionsTable)
      .set({
        runtimeProvisioningHeartbeatAt: heartbeatAt,
        runtimeProvisioningOperationId: operationId,
      })
      .where(runtimeProvisioningLeaseCondition(previous, true))
      .returning({ id: sessionsTable.id })
      .get();
    if (claimed !== undefined) {
      claims.push({ ...previous, heartbeatAt, operationId });
    }
  }

  return claims;
}

function runtimeProvisioningLeaseCondition(
  lease: RuntimeProvisioningLease,
  includeHeartbeat = false,
) {
  return and(
    eq(sessionsTable.id, lease.sessionId),
    eq(sessionsTable.runtimeProvisioningOperationId, lease.operationId),
    lease.runId === null
      ? isNull(sessionsTable.runtimeProvisioningRunId)
      : eq(sessionsTable.runtimeProvisioningRunId, lease.runId),
    eq(sessionsTable.runtimeProvisioningSandboxId, lease.sandboxId),
    lease.sandboxIncarnation === null
      ? isNull(sessionsTable.runtimeProvisioningSandboxIncarnation)
      : eq(sessionsTable.runtimeProvisioningSandboxIncarnation, lease.sandboxIncarnation),
    lease.sandboxSessionId === null
      ? isNull(sessionsTable.runtimeProvisioningSandboxSessionId)
      : eq(sessionsTable.runtimeProvisioningSandboxSessionId, lease.sandboxSessionId),
    ...(includeHeartbeat
      ? [eq(sessionsTable.runtimeProvisioningHeartbeatAt, lease.heartbeatAt)]
      : []),
  );
}

function runtimeProvisioningLeaseReleasePatch() {
  return {
    runtimeProvisioningHeartbeatAt: null,
    runtimeProvisioningOperationId: null,
    runtimeProvisioningRunId: null,
    runtimeProvisioningSandboxId: null,
    runtimeProvisioningSandboxIncarnation: null,
    runtimeProvisioningSandboxSessionId: null,
  } as const;
}
