import {
  driverInstancesTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../../platform/db/drizzle";
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
  readonly driverSandboxId: SandboxId;
  readonly driverSandboxSessionId: SessionId;
  readonly driverStatus: string;
  readonly runDriverInstanceId: DriverInstanceId | null;
  readonly runId: SessionRunId | null;
  readonly runSessionId: SessionId | null;
  readonly runStatus: string | null;
  readonly runStatusSeq: number | null;
  readonly sandboxId: SandboxId;
  readonly sandboxSessionStatus: string | null;
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

  const linked = await recordRuntimeRunLeaseLinked(appDb, {
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
        driverSandboxId: driverInstancesTable.sandboxId,
        driverSandboxSessionId: driverInstancesTable.sandboxSessionId,
        driverStatus: driverInstancesTable.status,
        runDriverInstanceId: sessionRunsTable.driverInstanceId,
        runId: sessionRunsTable.id,
        runSessionId: sessionRunsTable.sessionId,
        runStatus: sessionRunsTable.status,
        runStatusSeq: sessionRunsTable.statusSeq,
        sandboxId: driverInstancesTable.sandboxId,
        sandboxSessionStatus: sandboxSessionsTable.status,
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
  if (snapshot.runId === null) {
    return {
      reason: "run_not_found",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
    snapshot.driverSandboxId !== input.runtimeSubjectId ||
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

  if (snapshot.sandboxSessionStatus !== "active") {
    return {
      reason: "sandbox_session_not_active",
      status: "rejected",
      transition: "acquire",
    };
  }

  if (
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
  appDb: AppDatabase,
  input: RuntimeRunLeaseInput & {
    readonly now: number;
    readonly sandboxId: SandboxId;
    readonly statusSeq: number | null;
  },
): Promise<"linked" | "run_changed" | "run_link_conflict"> {
  if (input.statusSeq === null) {
    return "run_changed";
  }

  const linked =
    (await appDb
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
          eq(sessionRunsTable.statusSeq, input.statusSeq),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          or(
            isNull(sessionRunsTable.driverInstanceId),
            eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          ),
          notExists(
            appDb
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
      )
      .returning({ id: sessionRunsTable.id })
      .get()) ?? null;

  if (linked === null) {
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

  await appDb
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
    .where(eq(sandboxesTable.id, input.sandboxId))
    .run();

  return "linked";
}

export async function recordRuntimeRunLeaseReleased(
  database: D1Database,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedSessionRunId: SessionRunId;
  },
): Promise<boolean> {
  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, input);
  return isRuntimeRunLeaseSuccess(outcome);
}

export async function recordRuntimeRunLeaseReleasedOutcome(
  database: D1Database,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedSessionRunId: SessionRunId;
  },
): Promise<RuntimeRunLeaseTransitionOutcome> {
  const now = currentTimestampMs();
  const appDb = getAppDatabase(database);
  const driver =
    (await appDb
      .select({
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

  if (currentRun === null || currentRun.driverInstanceId === null) {
    if (activeDriverRun !== null && activeDriverRun.id !== input.expectedSessionRunId) {
      return {
        reason: "lease_mismatch",
        status: "stale",
        transition: "release",
      };
    }

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

  if (
    ACTIVE_SESSION_RUN_STATUSES.includes(
      currentRun.status as (typeof ACTIVE_SESSION_RUN_STATUSES)[number],
    )
  ) {
    const released =
      (await appDb
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
          ),
        )
        .returning({
          id: sessionRunsTable.id,
        })
        .get()) ?? null;

    if (!released) {
      return {
        reason: "run_changed",
        status: "stale",
        transition: "release",
      };
    }
  }

  await appDb
    .update(sandboxesTable)
    .set({
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadlineSql(now),
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, driver.sandboxId),
        notExists(activeConversationSessionQuery(appDb, driver.sandboxId)),
        notExists(runLeaseQuery(appDb, driver.sandboxId)),
      ),
    )
    .run();

  return {
    repaired: false,
    status: "applied",
    transition: "release",
  };
}
