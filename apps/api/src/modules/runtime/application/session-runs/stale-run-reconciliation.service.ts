import type { RunError } from "@mosoo/contracts/session-run";
import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../../domain/runtime-config";
import { setSessionRunStatus } from "../../infrastructure/session-runs/session-run-store.repository";

export interface ActiveRunDriverRow {
  driver_error_message: string | null;
  driver_last_heartbeat_at: number | null;
  driver_status: string | null;
  driver_updated_at: number | null;
  run_id: SessionRunId;
  session_id: SessionId;
  run_trace_id: string | null;
  run_updated_at: number;
}

export interface StaleActiveRunReconciliationResult {
  readonly reconciledRunIds: readonly SessionRunId[];
  readonly reconciledSessionIds: readonly SessionId[];
}

function latestRuntimeObservationMs(row: ActiveRunDriverRow): number {
  return Math.max(
    row.run_updated_at,
    row.driver_updated_at ?? 0,
    row.driver_last_heartbeat_at ?? 0,
  );
}

function staleRunError(row: ActiveRunDriverRow): RunError {
  const driverFailed = row.driver_status === "failed" || row.driver_status === "stopped";
  const message =
    row.driver_error_message ??
    (driverFailed
      ? "Runtime driver stopped before the run completed."
      : "Runtime session became inactive before the run completed.");

  return {
    code: driverFailed ? "runtime.driver_stopped" : "runtime.inactive",
    details: {},
    message,
    retryable: false,
  };
}

function shouldFailActiveRunAsStale(row: ActiveRunDriverRow, nowMs: number): boolean {
  if (row.driver_status === "failed" || row.driver_status === "stopped") {
    return true;
  }

  const staleBeforeMs = nowMs - RUNTIME_SOCKET_TIMEOUT_MS;
  return latestRuntimeObservationMs(row) < staleBeforeMs;
}

const runDriverInstancesTable = alias(driverInstancesTable, "run_driver");

const ACTIVE_SESSION_RUN_STATUSES = ["queued", "booting", "running", "waiting_input"] as const;

function activeRunDriverColumns() {
  return {
    driver_error_message: runDriverInstancesTable.errorMessage,
    driver_last_heartbeat_at: runDriverInstancesTable.lastHeartbeatAt,
    driver_status: runDriverInstancesTable.status,
    driver_updated_at: runDriverInstancesTable.updatedAt,
    run_id: sessionRunsTable.id,
    run_trace_id: sessionRunsTable.traceId,
    run_updated_at: sessionRunsTable.updatedAt,
    session_id: sessionRunsTable.sessionId,
  };
}

function latestRuntimeObservationSql() {
  return sql<number>`MAX(
    ${sessionRunsTable.updatedAt},
    COALESCE(${runDriverInstancesTable.updatedAt}, 0),
    COALESCE(${runDriverInstancesTable.lastHeartbeatAt}, 0)
  )`;
}

function staleActiveRunPredicate(nowMs: number) {
  return or(
    inArray(runDriverInstancesTable.status, ["failed", "stopped"]),
    lte(latestRuntimeObservationSql(), nowMs - RUNTIME_SOCKET_TIMEOUT_MS),
  );
}

async function findStaleActiveRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<ActiveRunDriverRow | null> {
  const row =
    (await getAppDatabase(database)
      .select(activeRunDriverColumns())
      .from(sessionRunsTable)
      .leftJoin(
        runDriverInstancesTable,
        eq(runDriverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .orderBy(
        desc(sessionRunsTable.createdAt),
        desc(sql`COALESCE(${runDriverInstancesTable.updatedAt}, 0)`),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return shouldFailActiveRunAsStale(row, currentTimestampMs()) ? row : null;
}

async function findStaleActiveRuns(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly nowMs: number;
  },
): Promise<ActiveRunDriverRow[]> {
  return getAppDatabase(database)
    .select(activeRunDriverColumns())
    .from(sessionRunsTable)
    .leftJoin(
      runDriverInstancesTable,
      eq(runDriverInstancesTable.id, sessionRunsTable.driverInstanceId),
    )
    .where(
      and(
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        staleActiveRunPredicate(input.nowMs),
      ),
    )
    .orderBy(asc(sessionRunsTable.updatedAt), asc(sessionRunsTable.id))
    .limit(input.limit)
    .all();
}

async function failStaleActiveRun(database: D1Database, staleRun: ActiveRunDriverRow) {
  const error = staleRunError(staleRun);
  const outcome = await setSessionRunStatus(database, {
    error,
    runId: staleRun.run_id,
    source: "maintenance",
    status: "failed",
  });

  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return true;
    }
    case "repair_needed": {
      throw new Error(
        "Stale session run reconciliation left the session lifecycle projection stale.",
      );
    }
    case "rejected":
    case "stale": {
      return false;
    }
  }
}

export async function reconcileStaleActiveSessionRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const staleRun = await findStaleActiveRun(database, sessionId);

  if (!staleRun) {
    return false;
  }

  return failStaleActiveRun(database, staleRun);
}

export async function reconcileStaleActiveSessionRuns(
  database: D1Database,
  input: {
    readonly limit: number;
  },
): Promise<StaleActiveRunReconciliationResult> {
  const staleRuns = await findStaleActiveRuns(database, {
    limit: input.limit,
    nowMs: currentTimestampMs(),
  });
  const reconciledRunIds: SessionRunId[] = [];
  const reconciledSessionIds = new Set<SessionId>();

  for (const staleRun of staleRuns) {
    if (await failStaleActiveRun(database, staleRun)) {
      reconciledRunIds.push(staleRun.run_id);
      reconciledSessionIds.add(staleRun.session_id);
    }
  }

  return {
    reconciledRunIds,
    reconciledSessionIds: [...reconciledSessionIds],
  };
}
