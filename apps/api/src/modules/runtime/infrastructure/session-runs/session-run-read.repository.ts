import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { toSessionRunSummary } from "./session-run-row.mapper";
import type { ActiveSessionRunStatus } from "./session-run-row.mapper";

const ACTIVE_SESSION_RUN_STATUSES: ActiveSessionRunStatus[] = [
  "queued",
  "booting",
  "running",
  "waiting_input",
];

function sessionRunSummaryColumns() {
  return {
    completed_at: sessionRunsTable.completedAt,
    created_at: sessionRunsTable.createdAt,
    deployment_version_id: sessionRunsTable.deploymentVersionId,
    deployment_version_number: sessionRunsTable.deploymentVersionNumber,
    error_code: sessionRunsTable.errorCode,
    error_details_json: sessionRunsTable.errorDetailsJson,
    error_message: sessionRunsTable.errorMessage,
    id: sessionRunsTable.id,
    model: sessionRunsTable.model,
    provider: sessionRunsTable.provider,
    session_id: sessionRunsTable.sessionId,
    started_at: sessionRunsTable.startedAt,
    status: sessionRunsTable.status,
    trace_id: sessionRunsTable.traceId,
    trigger: sessionRunsTable.trigger,
    updated_at: sessionRunsTable.updatedAt,
  };
}

export async function getSessionRunSummary(
  database: D1Database,
  runId: SessionRunId,
): Promise<SessionRunSummary | null> {
  const row =
    (await getAppDatabase(database)
      .select(sessionRunSummaryColumns())
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.id, runId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toSessionRunSummary(row);
}

export async function getSessionRunSummariesByIds(
  database: D1Database,
  runIds: SessionRunId[],
): Promise<Map<SessionRunId, SessionRunSummary>> {
  if (runIds.length === 0) {
    return new Map<SessionRunId, SessionRunSummary>();
  }

  const uniqueRunIds = [...new Set(runIds)];
  const rows = await getAppDatabase(database)
    .select(sessionRunSummaryColumns())
    .from(sessionRunsTable)
    .where(inArray(sessionRunsTable.id, uniqueRunIds))
    .all();

  if (rows.length === 0) {
    return new Map<SessionRunId, SessionRunSummary>();
  }

  const summaries = new Map<SessionRunId, SessionRunSummary>();

  for (const row of rows) {
    summaries.set(row.id, toSessionRunSummary(row));
  }

  return summaries;
}

export async function getActiveSessionRunSummary(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionRunSummary | null> {
  const row =
    (await getAppDatabase(database)
      .select(sessionRunSummaryColumns())
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .orderBy(desc(sessionRunsTable.createdAt))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toSessionRunSummary(row);
}

export async function getActiveSessionRunId(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionRunId | null> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .orderBy(desc(sessionRunsTable.createdAt))
      .limit(1)
      .get()) ?? null;

  return row?.id ?? null;
}

export async function hasActiveSessionRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.sessionId, sessionId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return row !== null;
}
