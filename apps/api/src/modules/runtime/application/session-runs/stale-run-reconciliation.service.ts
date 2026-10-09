import type { RunError } from "@mosoo/contracts/session-run";
import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { logWarn } from "../../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../../domain/runtime-config";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { classifyReclaim } from "../../domain/session-run-reclaim-recovery";
import { releaseRuntimeRunLease } from "../../infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import { setSessionRunStatus } from "../../infrastructure/session-runs/session-run-store.repository";

interface ActiveRunDriverRow {
  driver_error_message: string | null;
  driver_instance_id: DriverInstanceId | null;
  driver_status: string | null;
  run_id: SessionRunId;
  session_id: SessionId;
}

export interface StaleActiveRunReconciliationResult {
  readonly reconciledRunIds: readonly SessionRunId[];
  readonly reconciledSessionIds: readonly SessionId[];
}

function staleRunError(row: ActiveRunDriverRow): RunError {
  // A run found stale by the sweep is the same physical event class as a
  // synchronous socket-close reclaim, so classify it identically (retryable) —
  // this removes the retryable:true (sync) vs retryable:false (sweep)
  // contradiction for the same eviction.
  const driverTerminalStatus =
    row.driver_status === "failed" || row.driver_status === "stopped" ? row.driver_status : null;

  return classifyReclaim({
    driverErrorMessage: row.driver_error_message,
    driverTerminalStatus,
    reclaimReason: "heartbeat_stale",
  });
}

const runDriverInstancesTable = alias(driverInstancesTable, "run_driver");

function activeRunDriverColumns() {
  return {
    driver_error_message: runDriverInstancesTable.errorMessage,
    driver_instance_id: sessionRunsTable.driverInstanceId,
    driver_status: runDriverInstancesTable.status,
    run_id: sessionRunsTable.id,
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
  // Cold preparation restores the workspace before attaching a driver. It
  // needs the same startup allowance as a driver waiting to connect.
  return or(
    inArray(runDriverInstancesTable.status, ["failed", "stopped"]),
    and(
      or(eq(sessionRunsTable.status, "booting"), eq(runDriverInstancesTable.status, "connecting")),
      lte(latestRuntimeObservationSql(), nowMs - DRIVER_COLD_READY_TIMEOUT_MS),
    ),
    and(
      ne(sessionRunsTable.status, "booting"),
      or(
        isNull(runDriverInstancesTable.status),
        notInArray(runDriverInstancesTable.status, ["connecting", "failed", "stopped"]),
      ),
      lte(latestRuntimeObservationSql(), nowMs - RUNTIME_SOCKET_TIMEOUT_MS),
    ),
  );
}

async function findStaleActiveRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<ActiveRunDriverRow | null> {
  return (
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
          staleActiveRunPredicate(currentTimestampMs()),
        ),
      )
      .orderBy(
        desc(sessionRunsTable.createdAt),
        desc(sql`COALESCE(${runDriverInstancesTable.updatedAt}, 0)`),
      )
      .limit(1)
      .get()) ?? null
  );
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

  if (outcome.kind !== "applied" && outcome.kind !== "duplicate") {
    return false;
  }

  await releaseStaleRunLease(database, staleRun);
  return true;
}

// Failing the run ends the lease, but only the release write re-arms the
// subject inactive deadline; without it a pet sandbox stays active (and
// billing) with no deadline until the stranded-subject repair catches it.
async function releaseStaleRunLease(
  database: D1Database,
  staleRun: ActiveRunDriverRow,
): Promise<void> {
  if (staleRun.driver_instance_id === null) {
    return;
  }

  const released = await releaseRuntimeRunLease(database, {
    driverInstanceId: staleRun.driver_instance_id,
    expectedSessionRunId: staleRun.run_id,
  });

  if (!released) {
    logWarn("runtime.terminal.lease_release_skipped", {
      driverInstanceId: staleRun.driver_instance_id,
      sessionRunId: staleRun.run_id,
      source: "stale_run_reconciliation",
    });
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
