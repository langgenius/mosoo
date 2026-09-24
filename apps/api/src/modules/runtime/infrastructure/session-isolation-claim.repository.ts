import { sandboxSessionsTable, sandboxesTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, RuntimeOperationId, SandboxId } from "@mosoo/id";
import { and, asc, eq, exists, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { sessionIsolationClaimOwner } from "../../sessions/infrastructure/session-isolation-barrier.repository";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../domain/driver-instance-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";

export interface SessionIsolationCohort {
  sandbox: {
    id: SandboxId;
    subjectId: string;
    sandboxBinding: string;
    statusSeq: number;
    updatedAt: number;
  };
  sessions: Array<{ id: string; statusSeq: number; archivedAt: number | null }>;
}

/** Read-only qualification snapshot; claim rechecks membership and live work atomically. */
export async function readSessionIsolationCohort(
  database: D1Database,
  sandboxId: SandboxId,
): Promise<SessionIsolationCohort> {
  const db = getAppDatabase(database);
  const sandbox = await db
    .select({
      id: sandboxesTable.id,
      subjectId: sandboxesTable.subjectId,
      sandboxBinding: sandboxesTable.sandboxBinding,
      statusSeq: sandboxesTable.statusSeq,
      updatedAt: sandboxesTable.updatedAt,
    })
    .from(sandboxesTable)
    .where(
      and(
        eq(sandboxesTable.id, sandboxId),
        eq(sandboxesTable.kind, "pet"),
        eq(sandboxesTable.subjectKind, "agent"),
      ),
    )
    .get();
  if (!sandbox) throw new Error("Session isolation requires an existing shared Agent Sandbox.");
  const sessions = await db
    .select({
      id: sessionsTable.id,
      statusSeq: sessionsTable.statusSeq,
      archivedAt: sessionsTable.archivedAt,
    })
    .from(sessionsTable)
    .where(
      or(
        and(
          eq(sessionsTable.kind, "pet"),
          eq(
            sessionsTable.agentId,
            parsePlatformId<AgentId>(sandbox.subjectId, "shared Sandbox Agent"),
          ),
        ),
        exists(
          db
            .select({ id: sandboxSessionsTable.sessionId })
            .from(sandboxSessionsTable)
            .where(
              and(
                eq(sandboxSessionsTable.sessionId, sessionsTable.id),
                eq(sandboxSessionsTable.sandboxId, sandboxId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sessionsTable.id))
    .all();
  if (!sessions.length) throw new Error("Session isolation cohort is empty.");
  return { sandbox, sessions };
}

const ACTIVE_RUNS = ACTIVE_SESSION_RUN_STATUSES.map((s) => `'${s}'`).join(",");
const LIVE_DRIVERS = LIVE_DRIVER_INSTANCE_STATUSES.map((s) => `'${s}'`).join(",");

/** Internal D1 barrier only. Physical exclusion and verified conversion are separate steps. */
export function prepareSessionIsolationClaim(
  database: D1Database,
  input: { cohort: SessionIsolationCohort; operationId: RuntimeOperationId; now: number },
): D1PreparedStatement[] {
  const { cohort, operationId, now } = input;
  if (
    !cohort.sessions.length ||
    new Set(cohort.sessions.map((s) => s.id)).size !== cohort.sessions.length
  ) {
    throw new Error("Session isolation cohort must contain unique Session IDs.");
  }
  const owner = sessionIsolationClaimOwner(operationId);
  const expected = JSON.stringify({ ...cohort, operationId, owner });
  const member = `(s.kind = 'pet' AND s.agent_id = json_extract(e.value, '$.sandbox.subjectId'))
    OR EXISTS (SELECT 1 FROM sandbox_session w WHERE w.session_id = s.id
      AND w.sandbox_id = json_extract(e.value, '$.sandbox.id'))`;
  // Both a first claim and a retry of that exact retained claim are valid.
  // A released operation cannot reacquire: Session status_seq advanced again.
  const guard = `WITH e(value) AS (SELECT ?) SELECT CASE WHEN
    EXISTS (SELECT 1 FROM sandbox b WHERE b.id = json_extract(e.value, '$.sandbox.id')
      AND b.kind = 'pet' AND b.subject_kind = 'agent'
      AND b.subject_id = json_extract(e.value, '$.sandbox.subjectId')
      AND b.sandbox_binding = json_extract(e.value, '$.sandbox.sandboxBinding')
      AND b.status = 'cold' AND b.status_event = 'runtime_subject.cold'
      AND b.status_seq = json_extract(e.value, '$.sandbox.statusSeq')
      AND b.claim_expires_at IS NULL
      AND ((b.claim_owner IS NULL AND b.updated_at = json_extract(e.value, '$.sandbox.updatedAt'))
        OR b.claim_owner = json_extract(e.value, '$.owner')))
    AND (SELECT COUNT(*) FROM session s WHERE ${member}) = json_array_length(e.value, '$.sessions')
    AND NOT EXISTS (SELECT 1 FROM session s WHERE (${member}) AND NOT EXISTS (
      SELECT 1 FROM json_each(e.value, '$.sessions') v WHERE s.id = json_extract(v.value, '$.id')
      AND s.status = 'IDLE' AND s.archived_at IS json_extract(v.value, '$.archivedAt')
      AND ((s.status_operation_id IS NULL AND s.status_seq = json_extract(v.value, '$.statusSeq')
          AND (SELECT claim_owner FROM sandbox WHERE id = json_extract(e.value, '$.sandbox.id')) IS NULL)
        OR (s.status_operation_id = json_extract(e.value, '$.operationId')
          AND s.status_seq = json_extract(v.value, '$.statusSeq') + 1
          AND (SELECT claim_owner FROM sandbox WHERE id = json_extract(e.value, '$.sandbox.id')) = json_extract(e.value, '$.owner')))))
    AND NOT EXISTS (SELECT 1 FROM sandbox WHERE claim_owner = json_extract(e.value, '$.owner')
      AND id <> json_extract(e.value, '$.sandbox.id'))
    AND NOT EXISTS (SELECT 1 FROM sandbox_session w
      WHERE w.sandbox_id = json_extract(e.value, '$.sandbox.id') AND w.status <> 'closed')
    AND NOT EXISTS (SELECT 1 FROM driver_instance d
      WHERE d.sandbox_id = json_extract(e.value, '$.sandbox.id') AND d.status IN (${LIVE_DRIVERS}))
    AND NOT EXISTS (SELECT 1 FROM session_run r WHERE r.status IN (${ACTIVE_RUNS}) AND (
      r.agent_id = json_extract(e.value, '$.sandbox.subjectId')
      OR r.session_id IN (SELECT json_extract(v.value, '$.id') FROM json_each(e.value, '$.sessions') v)
      OR EXISTS (SELECT 1 FROM driver_instance d WHERE d.id = r.driver_instance_id
        AND d.sandbox_id = json_extract(e.value, '$.sandbox.id'))))
    THEN 1 ELSE json('session isolation cohort changed or is busy') END AS ready FROM e`;
  return [
    database.prepare(guard).bind(expected),
    database
      .prepare(`UPDATE session SET status_operation_id = ?, status_seq = status_seq + 1
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND status_operation_id IS NULL`)
      .bind(operationId, JSON.stringify(cohort.sessions)),
    database
      .prepare(`UPDATE sandbox SET claim_owner = ?, updated_at = ?
      WHERE id = ? AND claim_owner IS NULL`)
      .bind(owner, now, cohort.sandbox.id),
  ];
}

export async function claimSessionIsolationCohort(
  database: D1Database,
  input: { cohort: SessionIsolationCohort; operationId: RuntimeOperationId; now: number },
): Promise<void> {
  await database.batch(prepareSessionIsolationClaim(database, input));
}

/** Call only after all owned physical fences are safely released; never expire a claim. */
export function prepareSessionIsolationRelease(
  database: D1Database,
  input: { cohort: SessionIsolationCohort; operationId: RuntimeOperationId; now: number },
): D1PreparedStatement[] {
  const { cohort, operationId, now } = input;
  if (
    !cohort.sessions.length ||
    new Set(cohort.sessions.map((s) => s.id)).size !== cohort.sessions.length
  ) {
    throw new Error("Session isolation cohort must contain unique Session IDs.");
  }
  const owner = sessionIsolationClaimOwner(operationId);
  const expected = JSON.stringify({ ...cohort, operationId, owner });
  return [
    database
      .prepare(`WITH e(value) AS (SELECT ?) SELECT CASE WHEN
      EXISTS (SELECT 1 FROM sandbox WHERE id = json_extract(e.value, '$.sandbox.id')
        AND claim_owner = json_extract(e.value, '$.owner'))
      AND NOT EXISTS (SELECT 1 FROM json_each(e.value, '$.sessions') v WHERE NOT EXISTS (
        SELECT 1 FROM session s WHERE s.id = json_extract(v.value, '$.id')
          AND s.status = 'IDLE' AND s.status_operation_id = json_extract(e.value, '$.operationId')
          AND s.status_seq = json_extract(v.value, '$.statusSeq') + 1))
      AND NOT EXISTS (SELECT 1 FROM sandbox WHERE claim_owner = json_extract(e.value, '$.owner')
        AND (status <> 'cold' OR (id <> json_extract(e.value, '$.sandbox.id') AND NOT (
          subject_kind = 'session' AND subject_id IN (
            SELECT json_extract(value, '$.id') FROM json_each(e.value, '$.sessions'))))))
      AND NOT EXISTS (SELECT 1 FROM sandbox_session w JOIN sandbox b ON b.id = w.sandbox_id
        WHERE b.claim_owner = json_extract(e.value, '$.owner') AND w.status <> 'closed')
      AND NOT EXISTS (SELECT 1 FROM driver_instance d JOIN sandbox b ON b.id = d.sandbox_id
        WHERE b.claim_owner = json_extract(e.value, '$.owner') AND d.status IN (${LIVE_DRIVERS}))
      AND NOT EXISTS (SELECT 1 FROM session_run r WHERE r.status IN (${ACTIVE_RUNS}) AND (
        r.session_id IN (SELECT json_extract(value, '$.id') FROM json_each(e.value, '$.sessions'))
        OR EXISTS (SELECT 1 FROM sandbox_session w JOIN sandbox b ON b.id = w.sandbox_id
          WHERE w.session_id = r.session_id AND b.claim_owner = json_extract(e.value, '$.owner'))
        OR EXISTS (SELECT 1 FROM driver_instance d JOIN sandbox b ON b.id = d.sandbox_id
          WHERE d.id = r.driver_instance_id AND b.claim_owner = json_extract(e.value, '$.owner'))))
      THEN 1 ELSE json('session isolation release owner or state changed') END AS ready FROM e`)
      .bind(expected),
    database
      .prepare(`UPDATE session SET status_operation_id = NULL, status_seq = status_seq + 1
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?)) AND status_operation_id = ?`)
      .bind(JSON.stringify(cohort.sessions), operationId),
    database
      .prepare("UPDATE sandbox SET claim_owner = NULL, updated_at = ? WHERE claim_owner = ?")
      .bind(now, owner),
  ];
}

export async function releaseSessionIsolationCohort(
  database: D1Database,
  input: { cohort: SessionIsolationCohort; operationId: RuntimeOperationId; now: number },
): Promise<void> {
  await database.batch(prepareSessionIsolationRelease(database, input));
}
