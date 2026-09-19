import type { RunError } from "@mosoo/contracts/session-run";
import { sessionRunBudgetsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, ProjectId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";

export class SessionRunBudgetError extends Error {
  readonly code:
    | "budget_exhausted"
    | "budget_usage_unavailable"
    | "budget_request_in_flight"
    | "budget_run_unavailable";
  readonly status: number;
  constructor(code: SessionRunBudgetError["code"], status: number) {
    super(
      code === "budget_exhausted"
        ? "The turn's model budget is exhausted. No new model request was sent."
        : code === "budget_request_in_flight"
          ? "The previous model request is still settling its usage. Retry shortly."
          : "The turn's model usage cannot be established. No new model request was sent.",
    );
    this.code = code;
    this.status = status;
  }
}

export interface ModelRequestBudgetReservation {
  requestId: string;
  runId: SessionRunId;
  pricedAtMs: number;
}

export async function reserveSessionRunModelRequest(
  database: D1Database,
  input: { driverInstanceId: DriverInstanceId; projectId: ProjectId },
): Promise<ModelRequestBudgetReservation | null> {
  const db = getAppDatabase(database);
  const run = await db
    .select({ id: sessionRunsTable.id, budget: sessionRunBudgetsTable })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .leftJoin(sessionRunBudgetsTable, eq(sessionRunBudgetsTable.sessionRunId, sessionRunsTable.id))
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        eq(sessionsTable.projectId, input.projectId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .get();
  if (!run) {
    const priorBudget = await db
      .select({ id: sessionRunBudgetsTable.sessionRunId })
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .innerJoin(
        sessionRunBudgetsTable,
        eq(sessionRunBudgetsTable.sessionRunId, sessionRunsTable.id),
      )
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          eq(sessionsTable.projectId, input.projectId),
        ),
      )
      .limit(1)
      .get();
    // Preserve legacy proxy behavior, but a grant that belonged to a budgeted
    // turn cannot resume spending after that turn has ended.
    if (priorBudget) throw new SessionRunBudgetError("budget_run_unavailable", 409);
    return null;
  }
  // Existing admitted turns remain unbudgeted until a new turn records a policy.
  if (!run.budget) return null;
  const requestId = createPlatformId();
  const changed = await db
    .update(sessionRunBudgetsTable)
    .set({ activeRequestId: requestId, updatedAt: currentTimestampMs() })
    .where(
      and(
        eq(sessionRunBudgetsTable.sessionRunId, run.id),
        isNull(sessionRunBudgetsTable.activeRequestId),
        isNull(sessionRunBudgetsTable.blockedReason),
        lt(sessionRunBudgetsTable.estimatedCostUsdMicros, sessionRunBudgetsTable.capUsdMicros),
        sql`EXISTS (SELECT 1 FROM ${sessionRunsTable} WHERE ${sessionRunsTable.id} = ${run.id} AND ${inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES)})`,
      ),
    )
    .run();
  if (getD1ChangeCount(changed) === 0) {
    const current = await db
      .select()
      .from(sessionRunBudgetsTable)
      .where(eq(sessionRunBudgetsTable.sessionRunId, run.id))
      .get();
    if (!current) throw new SessionRunBudgetError("budget_run_unavailable", 409);
    if (current.blockedReason) throw new SessionRunBudgetError(current.blockedReason, 402);
    if (current.estimatedCostUsdMicros >= current.capUsdMicros)
      throw new SessionRunBudgetError("budget_exhausted", 402);
    throw new SessionRunBudgetError("budget_request_in_flight", 429);
  }
  return { requestId, runId: run.id, pricedAtMs: run.budget.createdAt };
}

export async function settleSessionRunModelRequest(
  database: D1Database,
  reservation: ModelRequestBudgetReservation,
  estimatedCostUsdMicros: number | null,
): Promise<void> {
  await getAppDatabase(database)
    .update(sessionRunBudgetsTable)
    .set({
      activeRequestId: null,
      estimatedCostUsdMicros: sql`${sessionRunBudgetsTable.estimatedCostUsdMicros} + ${estimatedCostUsdMicros ?? 0}`,
      blockedReason:
        estimatedCostUsdMicros === null
          ? "budget_usage_unavailable"
          : sql`CASE WHEN ${sessionRunBudgetsTable.estimatedCostUsdMicros} + ${estimatedCostUsdMicros} >= ${sessionRunBudgetsTable.capUsdMicros} THEN 'budget_exhausted' ELSE ${sessionRunBudgetsTable.blockedReason} END`,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sessionRunBudgetsTable.sessionRunId, reservation.runId),
        eq(sessionRunBudgetsTable.activeRequestId, reservation.requestId),
      ),
    )
    .run();
}

export async function getSessionRunBudgetFailure(
  database: D1Database,
  runId: SessionRunId,
): Promise<RunError | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(sessionRunBudgetsTable)
    .where(eq(sessionRunBudgetsTable.sessionRunId, runId))
    .get();
  if (!row) return null;
  const reason =
    row.blockedReason ?? (row.activeRequestId === null ? null : "budget_usage_unavailable");
  if (!reason) return null;
  return {
    code: reason,
    message: new SessionRunBudgetError(reason, 402).message,
    retryable: false,
    details: {
      capUsd: row.capUsdMicros / 1_000_000,
      estimatedCostUsd: row.estimatedCostUsdMicros / 1_000_000,
    },
  };
}
