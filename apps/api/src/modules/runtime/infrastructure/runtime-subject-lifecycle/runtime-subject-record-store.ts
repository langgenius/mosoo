import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import { projectsTable, sandboxesTable, sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  PlatformId,
  ProjectId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
} from "@mosoo/id";
import { and, asc, eq, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { sandboxBindingForRuntime } from "../../../../platform/cloudflare/sandbox-binding";
import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { RUNTIME_SUBJECT_CLAIMABLE_STATUSES } from "../../domain/runtime-subject-lifecycle.machine";
import type { RuntimeSubjectOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";
import { getRuntimeSubjectInactiveDeadline } from "../../domain/session-runtime-policy";
import type { RuntimeSubjectCapacityShortfall } from "./runtime-subject-errors";
import {
  activeConversationSessionQueryForListedSubject,
  activeSessionRunQueryForListedSubject,
  exclusiveSessionRuntimeSubjectPredicate,
  liveDriverInstanceQueryForListedSubject,
  runLeaseQuery,
  runLeaseQueryForListedSubject,
} from "./runtime-subject-store-queries";
import type {
  RuntimeSubjectActivationRecord,
  RuntimeSubjectOperationRepairCandidate,
  RuntimeSubjectStatus,
} from "./runtime-subject-store.types";

interface SessionRuntimeSubjectScope {
  readonly projectId: ProjectId;
  readonly executionOwnerUserId: AccountId;
  readonly sessionId: SessionId;
}

export interface SessionRuntimeSubjectBinding {
  readonly ownerAccountId: AccountId | null;
  readonly projectId: ProjectId | null;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
}

export function assertSessionRuntimeSubjectBinding(
  record: SessionRuntimeSubjectBinding,
  input: SessionRuntimeSubjectScope,
): void {
  if (
    record.subjectKind !== "session" ||
    record.subjectId !== input.sessionId ||
    record.projectId !== input.projectId ||
    record.ownerAccountId !== input.executionOwnerUserId
  ) {
    throw new Error("Session does not have a verified exclusive execution binding.");
  }
}

const sessionBindingColumns = {
  ownerAccountId: sandboxesTable.ownerAccountId,
  projectId: sandboxesTable.projectId,
  subjectId: sandboxesTable.subjectId,
  subjectKind: sandboxesTable.subjectKind,
};

// One atomic deployment ceiling across image classes, preserving the former
// single class's 50-subject capacity instead of multiplying it by four.
const RUNTIME_SUBJECT_DEPLOYMENT_SANDBOX_LIMIT = 50;
const ACCOUNT_CONCURRENT_SANDBOX_LIMIT = 5;

interface RuntimeSubjectCapacityInput {
  readonly executionOwnerUserId: AccountId;
  readonly now: number;
}

function deploymentSandboxCountSql(now: number): SQL<number> {
  return sql<number>`(
    SELECT COUNT(*) FROM ${sandboxesTable} AS deployment_sandbox
    WHERE deployment_sandbox.status IN ('restoring', 'active', 'backing_up', 'destroying')
      OR (deployment_sandbox.claim_owner IS NOT NULL AND deployment_sandbox.claim_expires_at > ${now})
  )`;
}

function accountSandboxCountSql(accountId: AccountId, now: number): SQL<number> {
  return sql<number>`(
    SELECT COUNT(*)
    FROM ${sandboxesTable} AS account_sandbox
    WHERE account_sandbox.owner_account_id = ${accountId}
      AND (
        account_sandbox.status IN ('restoring', 'active', 'backing_up', 'destroying')
        OR (
          account_sandbox.claim_owner IS NOT NULL
          AND account_sandbox.claim_expires_at > ${now}
        )
      )
  )`;
}

function runtimeSubjectAccountCapacityPredicate(input: RuntimeSubjectCapacityInput): SQL {
  // ponytail: use the existing status/claim indexes until measured contention
  // justifies durable admission counters.
  return sql`${deploymentSandboxCountSql(input.now)} < ${RUNTIME_SUBJECT_DEPLOYMENT_SANDBOX_LIMIT}
    AND ${accountSandboxCountSql(input.executionOwnerUserId, input.now)} < ${ACCOUNT_CONCURRENT_SANDBOX_LIMIT}`;
}

// Explains a refused cold activation after the fact. Counts can move between
// the claim and this read, so `null` leaves the caller's generic failure.
export async function readRuntimeSubjectCapacityShortfall(
  database: D1Database,
  input: RuntimeSubjectCapacityInput,
): Promise<RuntimeSubjectCapacityShortfall | null> {
  const counts = await getAppDatabase(database).get<{ account: number; deployment: number }>(
    sql`SELECT
      ${deploymentSandboxCountSql(input.now)} AS deployment,
      ${accountSandboxCountSql(input.executionOwnerUserId, input.now)} AS account`,
  );

  if (!counts) {
    return null;
  }

  if (counts.deployment >= RUNTIME_SUBJECT_DEPLOYMENT_SANDBOX_LIMIT) {
    return { limit: RUNTIME_SUBJECT_DEPLOYMENT_SANDBOX_LIMIT, scope: "platform" };
  }

  if (counts.account >= ACCOUNT_CONCURRENT_SANDBOX_LIMIT) {
    return { limit: ACCOUNT_CONCURRENT_SANDBOX_LIMIT, scope: "account" };
  }

  return null;
}

function runtimeSubjectStatusPatch(input: {
  readonly now: number;
  readonly operationId: RuntimeOperationId | null;
  readonly status: RuntimeSubjectStatus;
}) {
  return {
    status: input.status,
    statusChangedAt: input.now,
    statusOperationId: input.operationId ?? null,
    statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
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

async function findRuntimeSubjectAllocation(
  database: D1Database,
  input: SessionRuntimeSubjectScope & { readonly runtimeSubjectId?: SandboxId },
  boundSandboxId: SandboxId | null,
): Promise<{ id: SandboxId; sandboxBinding: string } | null> {
  const rows = await getAppDatabase(database)
    .select({
      id: sandboxesTable.id,
      sandboxBinding: sandboxesTable.sandboxBinding,
      ...sessionBindingColumns,
    })
    .from(sandboxesTable)
    .where(
      or(
        and(
          eq(sandboxesTable.subjectKind, "session"),
          eq(sandboxesTable.subjectId, input.sessionId),
        ),
        ...(boundSandboxId === null ? [] : [eq(sandboxesTable.id, boundSandboxId)]),
        ...(input.runtimeSubjectId === undefined
          ? []
          : [eq(sandboxesTable.id, input.runtimeSubjectId)]),
      ),
    )
    .limit(2)
    .all();
  if (rows.length > 1) throw new Error("Session execution binding is ambiguous.");
  const row = rows[0];
  if (row === undefined) {
    if (boundSandboxId !== null)
      throw new Error("Session execution binding has no recorded resource.");
    return null;
  }
  if (boundSandboxId !== null && row.id !== boundSandboxId) {
    throw new Error("Session execution binding changed before allocation.");
  }
  assertSessionRuntimeSubjectBinding(row, input);
  if (input.runtimeSubjectId !== undefined && row.id !== input.runtimeSubjectId) {
    throw new Error("Session execution binding changed before allocation.");
  }
  return row;
}

export async function ensureRuntimeSubjectId(
  database: D1Database,
  input: {
    readonly agentId: AgentId | null;
    readonly projectId: ProjectId;
    readonly executionOwnerUserId: AccountId;
    readonly runtimeId: string;
    readonly runtimeImagesEnabled?: boolean;
    readonly now?: number;
    readonly runtimeSubjectId?: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<SandboxId> {
  const authority = await getAppDatabase(database)
    .select({ id: sessionsTable.id, sandboxId: sandboxSessionsTable.sandboxId })
    .from(sessionsTable)
    .leftJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .innerJoin(projectsTable, eq(projectsTable.id, sessionsTable.projectId))
    .where(
      and(
        eq(sessionsTable.id, input.sessionId),
        eq(sessionsTable.projectId, input.projectId),
        eq(projectsTable.ownerAccountId, input.executionOwnerUserId),
      ),
    )
    .get();
  if (!authority) throw new Error("Session execution authority is unavailable.");
  const expectedBinding = sandboxBindingForRuntime(input.runtimeId);
  const sandboxBinding = input.runtimeImagesEnabled === true ? expectedBinding : "Sandbox";
  const existing = await findRuntimeSubjectAllocation(database, input, authority.sandboxId);

  if (existing !== null) {
    assertRuntimeSubjectImage(existing.sandboxBinding, expectedBinding);
    return existing.id;
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
      sandboxBinding,
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(now),
      kind: "cattle",
      ownerAccountId: input.executionOwnerUserId,
      status: "cold",
      statusChangedAt: now,
      statusOperationId: null,
      statusSeq: 0,
      subjectId: input.sessionId,
      subjectKind: "session",
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (getD1ChangeCount(result) > 0) {
    return runtimeSubjectId;
  }

  const createdByConcurrentRequest = await findRuntimeSubjectAllocation(
    database,
    input,
    authority.sandboxId,
  );

  if (createdByConcurrentRequest === null) {
    throw new Error("Runtime subject could not be allocated.");
  }

  assertRuntimeSubjectImage(createdByConcurrentRequest.sandboxBinding, expectedBinding);
  return createdByConcurrentRequest.id;
}

function assertRuntimeSubjectImage(actual: string, expected: string): void {
  if (actual !== "Sandbox" && actual !== expected) {
    throw new Error("Runtime subject image does not match the admitted runtime.");
  }
}

export async function getRuntimeSubjectActivationRecord(
  database: D1Database,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectActivationRecord | null> {
  return (
    (await getAppDatabase(database)
      .select({
        claimExpiresAt: sandboxesTable.claimExpiresAt,
        claimOwner: sandboxesTable.claimOwner,
        id: sandboxesTable.id,
        ...sessionBindingColumns,
        status: sandboxesTable.status,
      })
      .from(sandboxesTable)
      .where(eq(sandboxesTable.id, runtimeSubjectId))
      .get()) ?? null
  );
}

export async function claimRuntimeSubjectActivation(
  database: D1Database,
  input: {
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly executionOwnerUserId: AccountId;
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
          exclusiveSessionRuntimeSubjectPredicate(),
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
          exclusiveSessionRuntimeSubjectPredicate(),
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

export async function markRuntimeSubjectActive(
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
      claimExpiresAt: null,
      claimOwner: null,
      globalMountsJson: "[]",
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(now),
      lastError: null,
      lastErrorCode: null,
      status: "active",
      statusChangedAt: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusChangedAt}
	          ELSE ${now}
	        END
	      `,
      statusOperationId: null,
      statusSeq: sql`
	        CASE
	          WHEN ${sandboxesTable.status} = 'active' THEN ${sandboxesTable.statusSeq}
	          ELSE ${sandboxesTable.statusSeq} + 1
	        END
	      `,
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

/** Fence abandoned restores into the existing retryable teardown path. */
export async function claimExpiredRuntimeSubjectActivations(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly now: number;
    readonly staleChangedAtLte: number;
  },
): Promise<RuntimeSubjectOperationRepairCandidate[]> {
  const appDb = getAppDatabase(database);
  const eligible = and(
    eq(sandboxesTable.subjectKind, "session"),
    eq(sandboxesTable.status, "restoring"),
    lte(sandboxesTable.statusChangedAt, input.staleChangedAtLte),
    or(isNull(sandboxesTable.claimExpiresAt), lte(sandboxesTable.claimExpiresAt, input.now)),
    notExists(liveDriverInstanceQueryForListedSubject(appDb)),
    notExists(activeSessionRunQueryForListedSubject(appDb)),
    notExists(runLeaseQueryForListedSubject(appDb)),
  );
  const candidates = await appDb
    .select({ id: sandboxesTable.id, seq: sandboxesTable.statusSeq })
    .from(sandboxesTable)
    .where(eligible)
    .orderBy(asc(sandboxesTable.id))
    .limit(input.limit)
    .all();
  const claimed: RuntimeSubjectOperationRepairCandidate[] = [];
  for (const candidate of candidates) {
    const operationId = createPlatformId<RuntimeOperationId>();
    // Recheck both the lease and live-work guards at the write boundary.
    const result = await appDb
      .update(sandboxesTable)
      .set({
        claimOwner: null,
        claimExpiresAt: null,
        inactiveDeadlineAt: null,
        lastError: "Runtime subject activation expired before restore completed.",
        lastErrorCode: "runtime.subject_activation_failed",
        ...runtimeSubjectStatusPatch({
          now: input.now,
          operationId,
          status: "destroying",
        }),
      })
      .where(
        and(
          eligible,
          eq(sandboxesTable.id, candidate.id),
          eq(sandboxesTable.statusSeq, candidate.seq),
        ),
      )
      .run();
    if (getD1ChangeCount(result) > 0) {
      claimed.push({ id: candidate.id, operationId, status: "destroying" });
    }
  }
  return claimed;
}

export async function markRuntimeSubjectActivationDestroying(
  database: D1Database,
  input: {
    readonly claimOwner: string;
    readonly message: string;
    readonly operationId: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.message,
      lastErrorCode: "runtime.subject_activation_failed",
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        status: "destroying",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.claimOwner, input.claimOwner),
        // Activation can fail at any point after the claim: still cold (during
        // prepareFilesystem) or active.
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectActivationFailed(
  database: D1Database,
  input: {
    readonly message: string;
    readonly operationId: RuntimeOperationId;
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
      lastErrorCode: "runtime.subject_activation_failed",
      ...runtimeSubjectStatusPatch({
        now,
        operationId: null,
        status: "cold",
      }),
    })
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, "destroying"),
        eq(sandboxesTable.statusOperationId, input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markRuntimeSubjectOperationStarted(
  database: D1Database,
  input: {
    readonly claimOwner?: string;
    readonly now?: number;
    readonly operationId?: RuntimeOperationId | null;
    readonly runtimeSubjectId: SandboxId;
    readonly source?: "api" | "maintenance";
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<boolean> {
  const now = input.now ?? currentTimestampMs();
  const appDb = getAppDatabase(database);
  const claimPredicate =
    input.claimOwner === undefined
      ? or(
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.claimExpiresAt),
          lte(sandboxesTable.claimExpiresAt, now),
        )
      : eq(sandboxesTable.claimOwner, input.claimOwner);
  const result = await appDb
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
        status: input.status,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.subjectKind, "session"),
        eq(sandboxesTable.id, input.runtimeSubjectId),
        inArray(sandboxesTable.status, RUNTIME_SUBJECT_CLAIMABLE_STATUSES),
        claimPredicate,
        ...(input.source === "maintenance"
          ? [
              notExists(activeConversationSessionQueryForListedSubject(appDb)),
              notExists(activeSessionRunQueryForListedSubject(appDb)),
              notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
            ]
          : []),
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
        status: input.status,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.subjectKind, "session"),
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        ...runtimeSubjectStatusOperationCondition(input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function assertRuntimeSubjectOperationCurrent(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<void> {
  const record = await getAppDatabase(database)
    .select({ id: sandboxesTable.id })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.status),
        eq(sandboxesTable.statusOperationId, input.operationId),
      ),
    )
    .get();
  if (!record) throw new Error("Runtime subject moved on from this lifecycle operation.");
}

export async function markRuntimeSubjectCold(
  database: D1Database,
  input: {
    readonly expectedStatus: RuntimeSubjectOperationStatus;
    readonly operationId?: RuntimeOperationId | null;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

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
    readonly expectedStatus: RuntimeSubjectOperationStatus;
    readonly operationId: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const result = await getAppDatabase(database)
    .update(sandboxesTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastError: input.errorMessage,
      lastErrorCode: "runtime.subject_operation_failed",
      ...runtimeSubjectStatusPatch({
        now,
        operationId: input.operationId,
        status: input.expectedStatus,
      }),
    })
    .where(
      and(
        eq(sandboxesTable.subjectKind, "session"),
        eq(sandboxesTable.id, input.runtimeSubjectId),
        eq(sandboxesTable.status, input.expectedStatus),
        eq(sandboxesTable.statusOperationId, input.operationId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}
