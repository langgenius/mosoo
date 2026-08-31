import type { RunError } from "@mosoo/contracts/session-run";
import { driverInstancesTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  DRIVER_COLD_READY_TIMEOUT_MS,
  RUNTIME_SOCKET_TIMEOUT_MS,
} from "../../domain/runtime-config";
import { classifyReclaim } from "../../domain/session-run-reclaim-recovery";
import { recordRuntimeRunLeaseReleasedOutcome } from "../../infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import { recordCanonicalSessionRunTerminal } from "./session-run-terminal-failure.service";

export interface ActiveRunDriverRow {
  driver_error_message: string | null;
  driver_generation: number | null;
  driver_instance_id: DriverInstanceId | null;
  driver_last_heartbeat_at: number | null;
  driver_status: string | null;
  driver_updated_at: number | null;
  run_id: SessionRunId;
  run_status: "queued" | "booting" | "running" | "waiting_input";
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

function shouldFailActiveRunAsStale(row: ActiveRunDriverRow, nowMs: number): boolean {
  if (row.driver_status === "failed" || row.driver_status === "stopped") {
    return true;
  }

  const staleBeforeMs =
    row.driver_status === "connecting"
      ? nowMs - DRIVER_COLD_READY_TIMEOUT_MS
      : nowMs - RUNTIME_SOCKET_TIMEOUT_MS;
  return latestRuntimeObservationMs(row) < staleBeforeMs;
}

const runDriverInstancesTable = alias(driverInstancesTable, "run_driver");

const ACTIVE_SESSION_RUN_STATUSES = ["queued", "booting", "running", "waiting_input"] as const;

function activeRunDriverColumns() {
  return {
    driver_error_message: runDriverInstancesTable.errorMessage,
    driver_generation: runDriverInstancesTable.generation,
    driver_instance_id: sessionRunsTable.driverInstanceId,
    driver_last_heartbeat_at: runDriverInstancesTable.lastHeartbeatAt,
    driver_status: runDriverInstancesTable.status,
    driver_updated_at: runDriverInstancesTable.updatedAt,
    run_id: sessionRunsTable.id,
    run_status: sql<ActiveRunDriverRow["run_status"]>`${sessionRunsTable.status}`,
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
    and(
      eq(runDriverInstancesTable.status, "connecting"),
      lte(latestRuntimeObservationSql(), nowMs - DRIVER_COLD_READY_TIMEOUT_MS),
    ),
    and(
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
  const row =
    (await getAppDatabase(database)
      .select(activeRunDriverColumns())
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .leftJoin(
        runDriverInstancesTable,
        eq(runDriverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          isNull(sessionsTable.archivedAt),
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
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .leftJoin(
      runDriverInstancesTable,
      eq(runDriverInstancesTable.id, sessionRunsTable.driverInstanceId),
    )
    .where(
      and(
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        isNull(sessionsTable.archivedAt),
        staleActiveRunPredicate(input.nowMs),
      ),
    )
    .orderBy(asc(sessionRunsTable.updatedAt), asc(sessionRunsTable.id))
    .limit(input.limit)
    .all();
}

async function failStaleActiveRun(database: D1Database, staleRun: ActiveRunDriverRow) {
  const error = staleRunError(staleRun);
  const outcome = await recordCanonicalSessionRunTerminal({ DB: database } as ApiBindings, {
    assistantMessage: null,
    deliver: false,
    error,
    expectedDriverObservation: {
      driverInstanceId: staleRun.driver_instance_id,
      lastHeartbeatAt: staleRun.driver_last_heartbeat_at,
      status: staleRun.driver_status,
      updatedAt: staleRun.driver_updated_at,
    },
    expectedRunStatus: staleRun.run_status,
    runId: staleRun.run_id,
    sessionId: staleRun.session_id,
    source: "maintenance",
    status: "failed",
  });

  if (outcome.kind === "stale") {
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
  if (staleRun.driver_instance_id === null || staleRun.driver_generation === null) {
    return;
  }

  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, {
    driverInstanceId: staleRun.driver_instance_id,
    expectedDriverGeneration: staleRun.driver_generation,
    expectedSessionRunId: staleRun.run_id,
  });

  if (outcome.status !== "applied") {
    logWarn("runtime.terminal.lease_release_skipped", {
      driverInstanceId: staleRun.driver_instance_id,
      reason: "reason" in outcome ? outcome.reason : outcome.status,
      sessionRunId: staleRun.run_id,
      source: "stale_run_reconciliation",
      status: outcome.status,
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
