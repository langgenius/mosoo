import { AgentTaskSnapshot, AgentTasksReplacedPayload } from "@mosoo/contracts/session";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { sessionAgentTaskSnapshotsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { RuntimeEventId, SessionId } from "@mosoo/id";
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
    const payload = parseSchemaValue(AgentTasksReplacedPayload, JSON.parse(input.tasksJson));

    return parseSchemaValue(AgentTaskSnapshot, {
      driverInstanceId: input.driverInstanceId,
      runId: input.runId,
      tasks: payload.tasks,
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

export async function loadSessionAgentTaskSnapshot(
  database: D1Database,
  sessionId: SessionId,
): Promise<AgentTaskSnapshot | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        driverInstanceId: sessionAgentTaskSnapshotsTable.driverInstanceId,
        runId: sessionAgentTaskSnapshotsTable.runId,
        tasksJson: sessionAgentTaskSnapshotsTable.tasksJson,
      })
      .from(sessionAgentTaskSnapshotsTable)
      .innerJoin(
        sessionsTable,
        and(
          eq(sessionsTable.id, sessionAgentTaskSnapshotsTable.sessionId),
          eq(sessionsTable.lastRunId, sessionAgentTaskSnapshotsTable.runId),
        ),
      )
      .innerJoin(
        sessionRunsTable,
        and(
          eq(sessionRunsTable.id, sessionAgentTaskSnapshotsTable.runId),
          eq(sessionRunsTable.sessionId, sessionAgentTaskSnapshotsTable.sessionId),
          eq(sessionRunsTable.driverInstanceId, sessionAgentTaskSnapshotsTable.driverInstanceId),
        ),
      )
      .where(
        and(
          eq(sessionAgentTaskSnapshotsTable.sessionId, sessionId),
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

  return parseStoredAgentTaskSnapshot({
    driverInstanceId: row.driverInstanceId,
    runId: row.runId,
    sessionId,
    tasksJson: row.tasksJson,
  });
}
