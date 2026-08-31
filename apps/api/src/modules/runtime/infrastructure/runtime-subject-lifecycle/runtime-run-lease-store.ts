import {
  driverInstancesTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
} from "@mosoo/db";
import type {
  DriverInstanceId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, exists, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  ASSIGNABLE_DRIVER_STATUSES,
  activeConversationSessionQuery,
  getRuntimeSubjectInactiveDeadlineSql,
  runLeaseQuery,
} from "./runtime-subject-store-queries";
import type { AppDatabase } from "./runtime-subject-store-queries";
import type { RuntimeRunLeaseInput } from "./runtime-subject-store.types";

export type RuntimeRunLeaseTransitionOutcome =
  | {
      repaired: boolean;
      status: "applied";
      transition: "acquire" | "release";
    }
  | {
      status: "duplicate";
      transition: "acquire";
    }
  | {
      reason:
        | "driver_already_leased"
        | "driver_not_assignable"
        | "driver_not_found"
        | "driver_scope_mismatch"
        | "lease_missing"
        | "run_already_leased"
        | "run_not_active"
        | "run_not_found"
        | "run_scope_mismatch"
        | "sandbox_session_not_active";
      status: "rejected";
      transition: "acquire" | "release";
    }
  | {
      reason: "driver_changed" | "lease_mismatch" | "run_changed";
      status: "stale";
      transition: "acquire" | "release";
    }
  | {
      reason: "run_link_conflict";
      status: "repair-needed";
      transition: "acquire";
    };

interface RuntimeRunLeaseAcquireSnapshot {
  readonly driverActiveSessionRunId: SessionRunId | null;
  readonly driverGeneration: number;
  readonly driverSandboxId: SandboxId;
  readonly driverSandboxIncarnation: number;
  readonly driverSandboxSessionId: SessionId;
  readonly driverStatus: string;
  readonly driverStatusOperationId: RuntimeOperationId | null;
  readonly runDriverInstanceId: DriverInstanceId | null;
  readonly runId: SessionRunId | null;
  readonly runSessionId: SessionId | null;
  readonly runStatus: string | null;
  readonly runStatusSeq: number | null;
  readonly sandboxId: SandboxId;
  readonly sandboxSessionIncarnation: number | null;
  readonly sandboxSessionStatus: string | null;
  readonly subjectIncarnation: number | null;
  readonly subjectClaimOwner: string | null;
  readonly subjectOperationId: RuntimeOperationId | null;
  readonly subjectStatus: string | null;
}

const activeDriverLeaseRunsTable = alias(sessionRunsTable, "active_driver_lease");

function isRuntimeRunLeaseSuccess(outcome: RuntimeRunLeaseTransitionOutcome): boolean {
  return outcome.status === "applied" || outcome.status === "duplicate";
}

export async function recordRuntimeRunLeaseAcquired(
  database: D1Database,
  input: RuntimeRunLeaseInput,
): Promise<boolean> {
  const outcome = await recordRuntimeRunLeaseAcquiredOutcome(database, input);
  return isRuntimeRunLeaseSuccess(outcome);
}

export async function recordRuntimeRunLeaseAcquiredOutcome(
  database: D1Database,
  input: RuntimeRunLeaseInput,
): Promise<RuntimeRunLeaseTransitionOutcome> {
  const now = currentTimestampMs();
  const appDb = getAppDatabase(database);
  const snapshot = await readRuntimeRunLeaseAcquireSnapshot(appDb, input);

  if (!snapshot) {
    return {
      reason: "driver_not_found",
      status: "rejected",
      transition: "acquire",
    };
  }

  const admission = decideRuntimeRunLeaseAcquire(input, snapshot);

  if (admission.status === "rejected") {
    return admission;
  }

  const linked = await recordRuntimeRunLeaseLinked(database, {
    ...input,
    now,
    sandboxId: snapshot.sandboxId,
    statusSeq: snapshot.runStatusSeq,
  });

  if (linked !== "linked") {
    if (linked === "run_link_conflict") {
      return {
        reason: "run_link_conflict",
        status: "repair-needed",
        transition: "acquire",
      };
    }

    if (linked === "driver_changed") {
      return {
        reason: "driver_changed",
        status: "stale",
        transition: "acquire",
      };
    }

    return {
      reason: "run_changed",
      status: "stale",
      transition: "acquire",
    };
  }

  if (admission.status === "duplicate") {
    return admission;
  }

  return {
    repaired: false,
    status: "applied",
    transition: "acquire",
  };
}

async function readRuntimeRunLeaseAcquireSnapshot(
  appDb: AppDatabase,
  input: RuntimeRunLeaseInput,
): Promise<RuntimeRunLeaseAcquireSnapshot | null> {
  const row =
    (await appDb
      .select({
        driverGeneration: driverInstancesTable.generation,
        driverSandboxId: driverInstancesTable.sandboxId,
        driverSandboxIncarnation: driverInstancesTable.sandboxIncarnation,
        driverSandboxSessionId: driverInstancesTable.sandboxSessionId,
        driverStatus: driverInstancesTable.status,
        driverStatusOperationId: driverInstancesTable.statusOperationId,
        runDriverInstanceId: sessionRunsTable.driverInstanceId,
        runId: sessionRunsTable.id,
        runSessionId: sessionRunsTable.sessionId,
        runStatus: sessionRunsTable.status,
        runStatusSeq: sessionRunsTable.statusSeq,
        sandboxId: driverInstancesTable.sandboxId,
        sandboxSessionIncarnation: sandboxSessionsTable.sandboxIncarnation,
        sandboxSessionStatus: sandboxSessionsTable.status,
        subjectIncarnation: sandboxesTable.incarnation,
        subjectClaimOwner: sandboxesTable.claimOwner,
        subjectOperationId: sandboxesTable.statusOperationId,
        subjectStatus: sandboxesTable.status,
      })
      .from(driverInstancesTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, input.sessionRunId))
      .leftJoin(
        sandboxSessionsTable,
        and(
          eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
          eq(sandboxSessionsTable.sessionId, input.sessionId),
        ),
      )
      .leftJoin(sandboxesTable, eq(sandboxesTable.id, input.runtimeSubjectId))
      .where(eq(driverInstancesTable.id, input.driverInstanceId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  const activeDriverLease =
    (await appDb
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return {
    ...row,
    driverActiveSessionRunId: activeDriverLease?.id ?? null,
  };
}

function decideRuntimeRunLeaseAcquire(
  input: RuntimeRunLeaseInput,
  snapshot: RuntimeRunLeaseAcquireSnapshot,
): RuntimeRunLeaseTransitionOutcome {
  if (snapshot.driverGeneration !== input.driverGeneration) {
    return {
      reason: "driver_changed",
      status: "stale",
      transition: "acquire",
    };
  }

  if (snapshot.runId === null) {
    return {
      reason: "run_not_found",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.driverSandboxId !== input.runtimeSubjectId ||
    snapshot.driverSandboxIncarnation !== input.runtimeSubjectIncarnation ||
    snapshot.driverSandboxSessionId !== input.sessionId
  ) {
    return {
      reason: "driver_scope_mismatch",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (snapshot.runSessionId !== input.sessionId) {
    return {
      reason: "run_scope_mismatch",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    !ACTIVE_SESSION_RUN_STATUSES.includes(
      snapshot.runStatus as (typeof ACTIVE_SESSION_RUN_STATUSES)[number],
    )
  ) {
    return {
      reason: "run_not_active",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.sandboxSessionStatus !== "active" ||
    snapshot.sandboxSessionIncarnation !== input.runtimeSubjectIncarnation ||
    snapshot.subjectIncarnation !== input.runtimeSubjectIncarnation ||
    snapshot.subjectStatus !== "active" ||
    snapshot.subjectClaimOwner !== null ||
    snapshot.subjectOperationId !== null
  ) {
    return {
      reason: "sandbox_session_not_active",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.driverStatusOperationId !== null ||
    !ASSIGNABLE_DRIVER_STATUSES.includes(
      snapshot.driverStatus as (typeof ASSIGNABLE_DRIVER_STATUSES)[number],
    )
  ) {
    return {
      reason: "driver_not_assignable",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.driverActiveSessionRunId !== null &&
    snapshot.driverActiveSessionRunId !== input.sessionRunId
  ) {
    return {
      reason: "driver_already_leased",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.runDriverInstanceId !== null &&
    snapshot.runDriverInstanceId !== input.driverInstanceId
  ) {
    return {
      reason: "run_already_leased",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (snapshot.runDriverInstanceId === input.driverInstanceId) {
    return {
      status: "duplicate",
      transition: "acquire",
    };
  }

  return {
    repaired: false,
    status: "applied",
    transition: "acquire",
  };
}

async function recordRuntimeRunLeaseLinked(
  database: D1Database,
  input: RuntimeRunLeaseInput & {
    readonly now: number;
    readonly sandboxId: SandboxId;
    readonly statusSeq: number | null;
  },
): Promise<"driver_changed" | "linked" | "run_changed" | "run_link_conflict"> {
  if (input.statusSeq === null) {
    return "run_changed";
  }
  const statusSeq = input.statusSeq;

  const [linked] = await runAppDatabaseBatch(database, (db) => {
    const activeConversation = db
      .select({ id: sandboxSessionsTable.sessionId })
      .from(sandboxSessionsTable)
      .where(
        and(
          eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
          eq(sandboxSessionsTable.sandboxIncarnation, input.runtimeSubjectIncarnation),
          eq(sandboxSessionsTable.sessionId, input.sessionId),
          eq(sandboxSessionsTable.status, "active"),
        ),
      );
    const activeSubject = db
      .select({ id: sandboxesTable.id })
      .from(sandboxesTable)
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          eq(sandboxesTable.incarnation, input.runtimeSubjectIncarnation),
          eq(sandboxesTable.status, "active"),
          isNull(sandboxesTable.claimOwner),
          isNull(sandboxesTable.operationKind),
          isNull(sandboxesTable.statusOperationId),
        ),
      );
    const assignableDriver = db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.generation, input.driverGeneration),
          eq(driverInstancesTable.sandboxId, input.runtimeSubjectId),
          eq(driverInstancesTable.sandboxIncarnation, input.runtimeSubjectIncarnation),
          eq(driverInstancesTable.sandboxSessionId, input.sessionId),
          inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_STATUSES),
          isNull(driverInstancesTable.statusOperationId),
          exists(activeConversation),
          exists(activeSubject),
        ),
      );
    const exactLinkedRun = db
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.id, input.sessionRunId),
          eq(sessionRunsTable.sessionId, input.sessionId),
          eq(sessionRunsTable.statusSeq, statusSeq),
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      );

    return [
      db
        .update(sessionRunsTable)
        .set({
          driverInstanceId: input.driverInstanceId,
          updatedAt: sql<number>`
            CASE
              WHEN ${sessionRunsTable.driverInstanceId} IS NULL THEN ${input.now}
              ELSE ${sessionRunsTable.updatedAt}
            END
          `,
        })
        .where(
          and(
            eq(sessionRunsTable.id, input.sessionRunId),
            eq(sessionRunsTable.sessionId, input.sessionId),
            eq(sessionRunsTable.statusSeq, statusSeq),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
            or(
              isNull(sessionRunsTable.driverInstanceId),
              eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
            ),
            exists(assignableDriver),
            notExists(
              db
                .select({ id: activeDriverLeaseRunsTable.id })
                .from(activeDriverLeaseRunsTable)
                .where(
                  and(
                    eq(activeDriverLeaseRunsTable.driverInstanceId, input.driverInstanceId),
                    ne(activeDriverLeaseRunsTable.id, input.sessionRunId),
                    inArray(activeDriverLeaseRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
                  ),
                ),
            ),
          ),
        ),
      db
        .update(sandboxesTable)
        .set({
          inactiveDeadlineAt: null,
          updatedAt: sql<number>`
            CASE
              WHEN ${sandboxesTable.inactiveDeadlineAt} IS NULL THEN ${sandboxesTable.updatedAt}
              ELSE ${input.now}
            END
          `,
        })
        .where(
          and(
            eq(sandboxesTable.id, input.sandboxId),
            eq(sandboxesTable.incarnation, input.runtimeSubjectIncarnation),
            eq(sandboxesTable.status, "active"),
            isNull(sandboxesTable.claimOwner),
            isNull(sandboxesTable.operationKind),
            isNull(sandboxesTable.statusOperationId),
            exists(exactLinkedRun),
          ),
        ),
    ];
  });

  if (getD1ChangeCount(linked) === 0) {
    const appDb = getAppDatabase(database);
    const driver = await appDb
      .select({
        generation: driverInstancesTable.generation,
        sandboxIncarnation: driverInstancesTable.sandboxIncarnation,
        statusOperationId: driverInstancesTable.statusOperationId,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, input.driverInstanceId))
      .limit(1)
      .get();
    if (
      driver === undefined ||
      driver.generation !== input.driverGeneration ||
      driver.sandboxIncarnation !== input.runtimeSubjectIncarnation ||
      driver.statusOperationId !== null
    ) {
      return "driver_changed";
    }
    const current =
      (await appDb
        .select({
          driverInstanceId: sessionRunsTable.driverInstanceId,
          status: sessionRunsTable.status,
          statusSeq: sessionRunsTable.statusSeq,
        })
        .from(sessionRunsTable)
        .where(eq(sessionRunsTable.id, input.sessionRunId))
        .limit(1)
        .get()) ?? null;

    if (
      current === null ||
      current.statusSeq !== input.statusSeq ||
      !ACTIVE_SESSION_RUN_STATUSES.includes(
        current.status as (typeof ACTIVE_SESSION_RUN_STATUSES)[number],
      )
    ) {
      return "run_changed";
    }

    return "run_link_conflict";
  }

  return "linked";
}

export async function recordRuntimeRunLeaseReleased(
  database: D1Database,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedDriverGeneration: number;
    readonly expectedDriverOperationId?: RuntimeOperationId;
    readonly expectedSessionRunId: SessionRunId;
    readonly retainDriverOperationUntilTerminal?: boolean;
  },
): Promise<boolean> {
  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, input);
  return isRuntimeRunLeaseSuccess(outcome);
}

export async function recordRuntimeRunLeaseReleasedOutcome(
  database: D1Database,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedDriverGeneration: number;
    readonly expectedDriverOperationId?: RuntimeOperationId;
    readonly expectedSessionRunId: SessionRunId;
    readonly retainDriverOperationUntilTerminal?: boolean;
  },
): Promise<RuntimeRunLeaseTransitionOutcome> {
  if (
    input.retainDriverOperationUntilTerminal === true &&
    input.expectedDriverOperationId === undefined
  ) {
    throw new Error("A retained Driver release requires exact operation ownership.");
  }
  const now = currentTimestampMs();
  const appDb = getAppDatabase(database);
  const driver =
    (await appDb
      .select({
        generation: driverInstancesTable.generation,
        sandboxId: driverInstancesTable.sandboxId,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, input.driverInstanceId))
      .limit(1)
      .get()) ?? null;

  if (!driver) {
    return {
      reason: "driver_not_found",
      status: "rejected",
      transition: "release",
    };
  }

  if (driver.generation !== input.expectedDriverGeneration) {
    return {
      reason: "driver_changed",
      status: "stale",
      transition: "release",
    };
  }

  const currentRun =
    (await appDb
      .select({
        driverInstanceId: sessionRunsTable.driverInstanceId,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.id, input.expectedSessionRunId))
      .limit(1)
      .get()) ?? null;

  const activeDriverRun =
    (await appDb
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (activeDriverRun !== null && activeDriverRun.id !== input.expectedSessionRunId) {
    return {
      reason: "lease_mismatch",
      status: "stale",
      transition: "release",
    };
  }

  if (currentRun === null || currentRun.driverInstanceId === null) {
    return {
      reason: "lease_missing",
      status: "rejected",
      transition: "release",
    };
  }

  if (currentRun.driverInstanceId !== input.driverInstanceId) {
    return {
      reason: "lease_mismatch",
      status: "stale",
      transition: "release",
    };
  }

  const currentRunIsActive = ACTIVE_SESSION_RUN_STATUSES.includes(
    currentRun.status as (typeof ACTIVE_SESSION_RUN_STATUSES)[number],
  );
  const [released, , driverFence] = await runAppDatabaseBatch(database, (db) => {
    const exactDriverGeneration = db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.generation, input.expectedDriverGeneration),
          ...(input.expectedDriverOperationId === undefined
            ? []
            : [eq(driverInstancesTable.statusOperationId, input.expectedDriverOperationId)]),
        ),
      );

    return [
      db
        .update(sessionRunsTable)
        .set({
          driverInstanceId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sessionRunsTable.id, input.expectedSessionRunId),
            eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
            exists(exactDriverGeneration),
          ),
        ),
      db
        .update(sandboxesTable)
        .set({
          inactiveDeadlineAt: sql`COALESCE(
            ${sandboxesTable.inactiveDeadlineAt},
            ${getRuntimeSubjectInactiveDeadlineSql(now)}
          )`,
          updatedAt: sql<number>`CASE
            WHEN ${sandboxesTable.inactiveDeadlineAt} IS NULL THEN ${now}
            ELSE ${sandboxesTable.updatedAt}
          END`,
        })
        .where(
          and(
            eq(sandboxesTable.id, driver.sandboxId),
            exists(exactDriverGeneration),
            or(
              eq(sandboxesTable.kind, "pet"),
              notExists(activeConversationSessionQuery(db, driver.sandboxId)),
            ),
            notExists(runLeaseQuery(db, driver.sandboxId)),
          ),
        ),
      db
        .update(driverInstancesTable)
        .set(
          input.retainDriverOperationUntilTerminal === true
            ? {
                status: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN 'stopping'
                  ELSE ${driverInstancesTable.status}
                END`,
                statusChangedAt: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN ${now}
                  ELSE ${driverInstancesTable.statusChangedAt}
                END`,
                statusEvent: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN 'driver.stopping'
                  ELSE ${driverInstancesTable.statusEvent}
                END`,
                statusOperationId: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('stopped', 'failed') THEN NULL
                  ELSE ${driverInstancesTable.statusOperationId}
                END`,
                statusSeq: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN ${driverInstancesTable.statusSeq} + 1
                  ELSE ${driverInstancesTable.statusSeq}
                END`,
                statusSource: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN 'api'
                  ELSE ${driverInstancesTable.statusSource}
                END`,
                updatedAt: sql`CASE
                  WHEN ${driverInstancesTable.status} IN ('provisioning', 'connecting', 'ready')
                    THEN ${now}
                  ELSE ${driverInstancesTable.updatedAt}
                END`,
              }
            : {
                statusOperationId:
                  input.expectedDriverOperationId === undefined
                    ? sql`${driverInstancesTable.statusOperationId}`
                    : null,
              },
        )
        .where(
          and(
            eq(driverInstancesTable.id, input.driverInstanceId),
            eq(driverInstancesTable.generation, input.expectedDriverGeneration),
            ...(input.expectedDriverOperationId === undefined
              ? []
              : [eq(driverInstancesTable.statusOperationId, input.expectedDriverOperationId)]),
          ),
        ),
    ];
  });

  if (getD1ChangeCount(driverFence) === 0) {
    return {
      reason: "driver_changed",
      status: "stale",
      transition: "release",
    };
  }

  if (currentRunIsActive && getD1ChangeCount(released) === 0) {
    return {
      reason: "run_changed",
      status: "stale",
      transition: "release",
    };
  }

  return {
    repaired: false,
    status: "applied",
    transition: "release",
  };
}
