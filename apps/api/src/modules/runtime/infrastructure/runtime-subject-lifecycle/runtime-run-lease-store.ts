import {
  driverInstancesTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { and, eq, exists, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { ASSIGNABLE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import {
  activeConversationSessionQuery,
  getRuntimeSubjectInactiveDeadlineSql,
  runLeaseQuery,
} from "./runtime-subject-store-queries";
import type { RuntimeRunLeaseInput } from "./runtime-subject-store.types";

export type RuntimeRunLeaseAcquireOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly retryable: boolean };

const activeDriverLeaseRunsTable = alias(sessionRunsTable, "active_driver_lease");

function isActiveSessionRunStatus(status: string): boolean {
  return ACTIVE_SESSION_RUN_STATUSES.includes(
    status as (typeof ACTIVE_SESSION_RUN_STATUSES)[number],
  );
}

export async function acquireRuntimeRunLease(
  database: D1Database,
  input: RuntimeRunLeaseInput,
): Promise<RuntimeRunLeaseAcquireOutcome> {
  const now = currentTimestampMs();
  const appDb = getAppDatabase(database);
  const otherActiveDriverRun = appDb
    .select({ id: activeDriverLeaseRunsTable.id })
    .from(activeDriverLeaseRunsTable)
    .where(
      and(
        eq(activeDriverLeaseRunsTable.driverInstanceId, input.driverInstanceId),
        ne(activeDriverLeaseRunsTable.id, input.sessionRunId),
        inArray(activeDriverLeaseRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const linked =
    (await appDb
      .update(sessionRunsTable)
      .set({
        driverInstanceId: input.driverInstanceId,
        updatedAt: sql<number>`
          CASE
            WHEN ${sessionRunsTable.driverInstanceId} IS NULL THEN ${now}
            ELSE ${sessionRunsTable.updatedAt}
          END
        `,
      })
      .where(
        and(
          eq(sessionRunsTable.id, input.sessionRunId),
          eq(sessionRunsTable.sessionId, input.sessionId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          or(
            isNull(sessionRunsTable.driverInstanceId),
            eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          ),
          exists(
            appDb
              .select({ sessionId: sandboxSessionsTable.sessionId })
              .from(sandboxSessionsTable)
              .where(
                and(
                  eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
                  eq(sandboxSessionsTable.sessionId, input.sessionId),
                  eq(sandboxSessionsTable.status, "active"),
                ),
              ),
          ),
          exists(
            appDb
              .select({ id: driverInstancesTable.id })
              .from(driverInstancesTable)
              .where(
                and(
                  eq(driverInstancesTable.id, input.driverInstanceId),
                  eq(driverInstancesTable.sandboxId, input.runtimeSubjectId),
                  eq(driverInstancesTable.sandboxSessionId, input.sessionId),
                  inArray(driverInstancesTable.status, ASSIGNABLE_DRIVER_INSTANCE_STATUSES),
                ),
              ),
          ),
          notExists(otherActiveDriverRun),
        ),
      )
      .returning({ id: sessionRunsTable.id })
      .get()) ?? null;

  if (linked === null) {
    const current =
      (await appDb
        .select({
          driverInstanceId: sessionRunsTable.driverInstanceId,
          driverLeased: sql<number>`EXISTS ${otherActiveDriverRun}`,
          status: sessionRunsTable.status,
        })
        .from(sessionRunsTable)
        .where(eq(sessionRunsTable.id, input.sessionRunId))
        .get()) ?? null;

    if (current === null || !isActiveSessionRunStatus(current.status)) {
      return { ok: false, reason: "run_not_active", retryable: false };
    }

    if (current.driverInstanceId !== null && current.driverInstanceId !== input.driverInstanceId) {
      return { ok: false, reason: "run_already_leased", retryable: true };
    }

    if (current.driverLeased) {
      return { ok: false, reason: "driver_already_leased", retryable: true };
    }

    return { ok: false, reason: "driver_not_assignable", retryable: false };
  }

  await appDb
    .update(sandboxesTable)
    .set({
      inactiveDeadlineAt: null,
      updatedAt: sql<number>`
        CASE
          WHEN ${sandboxesTable.inactiveDeadlineAt} IS NULL THEN ${sandboxesTable.updatedAt}
          ELSE ${now}
        END
      `,
    })
    .where(eq(sandboxesTable.id, input.runtimeSubjectId))
    .run();

  return { ok: true };
}

// Terminal Runs keep their historical driver link; releasing one still re-arms
// the subject inactive deadline.
export async function releaseRuntimeRunLease(
  database: D1Database,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedSessionRunId: SessionRunId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();
  const appDb = getAppDatabase(database);
  const run =
    (await appDb
      .select({
        sandboxId: driverInstancesTable.sandboxId,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .innerJoin(
        driverInstancesTable,
        eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .where(
        and(
          eq(sessionRunsTable.id, input.expectedSessionRunId),
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .get()) ?? null;

  if (run === null) {
    return false;
  }

  if (isActiveSessionRunStatus(run.status)) {
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
        .returning({ id: sessionRunsTable.id })
        .get()) ?? null;

    if (!released) {
      return false;
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
        eq(sandboxesTable.id, run.sandboxId),
        eq(sandboxesTable.subjectKind, "session"),
        notExists(activeConversationSessionQuery(appDb, run.sandboxId)),
        notExists(runLeaseQuery(appDb, run.sandboxId)),
      ),
    )
    .run();

  return true;
}
