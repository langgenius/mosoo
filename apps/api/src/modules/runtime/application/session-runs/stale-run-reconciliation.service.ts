import type { RunError } from "@mosoo/contracts/session-run";
import { driverInstancesTable, sessionRunsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  run_trace_id: string | null;
  run_updated_at: number;
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

async function findStaleActiveRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<ActiveRunDriverRow | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        driver_error_message: runDriverInstancesTable.errorMessage,
        driver_last_heartbeat_at: runDriverInstancesTable.lastHeartbeatAt,
        driver_status: runDriverInstancesTable.status,
        driver_updated_at: runDriverInstancesTable.updatedAt,
        run_id: sessionRunsTable.id,
        run_trace_id: sessionRunsTable.traceId,
        run_updated_at: sessionRunsTable.updatedAt,
      })
      .from(sessionRunsTable)
      .leftJoin(
        runDriverInstancesTable,
        eq(runDriverInstancesTable.id, sessionRunsTable.driverInstanceId),
      )
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          inArray(sessionRunsTable.status, ["queued", "booting", "running", "waiting_input"]),
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

export async function reconcileStaleActiveSessionRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const staleRun = await findStaleActiveRun(database, sessionId);

  if (!staleRun) {
    return false;
  }

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
