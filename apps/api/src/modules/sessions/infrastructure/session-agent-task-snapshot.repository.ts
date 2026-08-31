import { AgentTaskSnapshot } from "@mosoo/contracts/session";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { sessionAgentTaskSnapshotsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../runtime/domain/session-run-lifecycle.machine";

export function prepareSessionAgentTaskSnapshotUpsert(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    snapshot: AgentTaskSnapshot;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO session_agent_task_snapshot (
        session_id,
        run_id,
        driver_instance_id,
        seq,
        tasks_json
      )
      SELECT
        receipt.session_id,
        receipt.run_id,
        current_run.driver_instance_id,
        receipt.seq,
        ?
      FROM session_event AS receipt
      JOIN session AS current_session
        ON current_session.id = receipt.session_id
      JOIN session_run AS current_run
        ON current_run.id = receipt.run_id
        AND current_run.session_id = receipt.session_id
      WHERE receipt.id = ?
        AND receipt.event_type = 'agent.tasks.replaced'
        AND receipt.run_id = ?
        AND current_session.last_run_id = receipt.run_id
        AND current_session.archived_at IS NULL
        AND current_session.status = 'RUNNING'
        AND current_run.driver_instance_id = ?
        AND current_run.status IN ('queued', 'booting', 'running', 'waiting_input')
      ON CONFLICT (session_id) DO UPDATE SET
        run_id = excluded.run_id,
        driver_instance_id = excluded.driver_instance_id,
        seq = excluded.seq,
        tasks_json = excluded.tasks_json
      WHERE excluded.seq > session_agent_task_snapshot.seq`,
    )
    .bind(
      JSON.stringify({ tasks: input.snapshot.tasks }),
      input.eventId,
      input.snapshot.runId,
      input.snapshot.driverInstanceId,
    );
}

export function parseStoredAgentTaskSnapshot(input: {
  driverInstanceId: string;
  runId: string;
  sessionId: string;
  tasksJson: string;
}): AgentTaskSnapshot | null {
  try {
    return parseSchemaValue(AgentTaskSnapshot, {
      ...JSON.parse(input.tasksJson),
      driverInstanceId: input.driverInstanceId,
      runId: input.runId,
    });
  } catch (error) {
    logWarn("session.agent_task_snapshot.invalid", {
      ...createErrorLogContext(error),
      runId: input.runId,
      sessionId: input.sessionId,
    });
    return null;
  }
}

export interface SessionAgentTaskState {
  driverInstanceId: string | null;
  runId: SessionRunId;
  runStatus: SessionRunStatus;
  snapshot: AgentTaskSnapshot | null;
}

export async function loadSessionAgentTaskState(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionAgentTaskState | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        runDriverInstanceId: sessionRunsTable.driverInstanceId,
        runId: sessionRunsTable.id,
        runStatus: sessionRunsTable.status,
        taskDriverInstanceId: sessionAgentTaskSnapshotsTable.driverInstanceId,
        taskRunId: sessionAgentTaskSnapshotsTable.runId,
        tasksJson: sessionAgentTaskSnapshotsTable.tasksJson,
      })
      .from(sessionsTable)
      .innerJoin(
        sessionRunsTable,
        and(
          eq(sessionRunsTable.id, sessionsTable.lastRunId),
          eq(sessionRunsTable.sessionId, sessionsTable.id),
        ),
      )
      .leftJoin(
        sessionAgentTaskSnapshotsTable,
        and(
          eq(sessionAgentTaskSnapshotsTable.sessionId, sessionsTable.id),
          eq(sessionAgentTaskSnapshotsTable.runId, sessionRunsTable.id),
          eq(sessionAgentTaskSnapshotsTable.driverInstanceId, sessionRunsTable.driverInstanceId),
        ),
      )
      .where(
        and(
          eq(sessionsTable.id, sessionId),
          isNull(sessionsTable.archivedAt),
          eq(sessionsTable.status, "RUNNING"),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  const snapshot =
    row.taskDriverInstanceId === null || row.taskRunId === null || row.tasksJson === null
      ? null
      : parseStoredAgentTaskSnapshot({
          driverInstanceId: row.taskDriverInstanceId,
          runId: row.taskRunId,
          sessionId,
          tasksJson: row.tasksJson,
        });

  return {
    driverInstanceId: row.runDriverInstanceId,
    runId: row.runId,
    runStatus: row.runStatus,
    snapshot,
  };
}

export async function loadSessionAgentTaskSnapshot(
  database: D1Database,
  sessionId: SessionId,
): Promise<AgentTaskSnapshot | null> {
  return (await loadSessionAgentTaskState(database, sessionId))?.snapshot ?? null;
}
