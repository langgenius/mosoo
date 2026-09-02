import type {
  SessionPermissionRequestView,
  SessionReadinessSnapshotView,
} from "@mosoo/ag-ui-session";
import { SessionReadinessSnapshotViewSchema } from "@mosoo/ag-ui-session";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import {
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeRunPayload,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export interface SessionViewerProjectionRuntimeEvent {
  readonly createdAt: number;
  readonly event: RuntimeEventEnvelope;
  readonly eventId: RuntimeEventId;
  readonly sessionId: SessionId;
}

const INSERTED_EVENT_FENCE = `EXISTS (
  SELECT 1
    FROM session_event AS receipt
   WHERE receipt.id = ?
     AND receipt.session_id = ?
     AND receipt.event_type = ?
)`;

function preparePermissionRequestUpsert(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
  request: SessionPermissionRequestView,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO session_permission_request (
         created_at, driver_instance_id, raw_input, request_id, run_id,
         session_id, title, tool_call_id, tool_kind, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${INSERTED_EVENT_FENCE}
       ON CONFLICT (session_id, request_id) DO UPDATE SET
         driver_instance_id = excluded.driver_instance_id,
         raw_input = excluded.raw_input,
         run_id = excluded.run_id,
         title = excluded.title,
         tool_call_id = excluded.tool_call_id,
         tool_kind = excluded.tool_kind,
         updated_at = excluded.updated_at`,
    )
    .bind(
      record.createdAt,
      request.driverInstanceId,
      request.rawInput,
      request.requestId,
      request.runId,
      record.sessionId,
      request.title,
      request.toolCallId,
      request.toolKind,
      record.createdAt,
      record.eventId,
      record.sessionId,
      record.event.kind,
    );
}

function preparePermissionRequestDelete(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
  runId: SessionRunId,
  requestId: string,
): D1PreparedStatement {
  return database
    .prepare(
      `DELETE FROM session_permission_request
        WHERE session_id = ?
          AND run_id = ?
          AND request_id = ?
          AND ${INSERTED_EVENT_FENCE}`,
    )
    .bind(record.sessionId, runId, requestId, record.eventId, record.sessionId, record.event.kind);
}

function requirePermissionRunId(record: SessionViewerProjectionRuntimeEvent): SessionRunId {
  if (record.event.runId === undefined) {
    throw new Error(`Runtime event ${record.event.kind} requires an exact Session Run identity.`);
  }
  return record.event.runId;
}

function preparePermissionRunStatusUpdate(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
  runId: SessionRunId,
): D1PreparedStatement {
  return database
    .prepare(
      `WITH desired AS (
         SELECT CASE WHEN EXISTS (
           SELECT 1 FROM session_permission_request AS permission
           WHERE permission.session_id = ? AND permission.run_id = ?
         ) THEN 'waiting_input' ELSE 'running' END AS next_status
       )
       UPDATE session_run
       SET status = (SELECT next_status FROM desired),
           status_changed_at = CASE
             WHEN status <> (SELECT next_status FROM desired) THEN ? ELSE status_changed_at END,
           status_event = CASE
             WHEN status <> (SELECT next_status FROM desired)
               THEN CASE (SELECT next_status FROM desired)
                 WHEN 'waiting_input' THEN 'run.wait_for_input' ELSE 'run.start' END
             ELSE status_event END,
           status_operation_id = CASE
             WHEN status <> (SELECT next_status FROM desired) THEN NULL ELSE status_operation_id END,
           status_seq = status_seq + CASE
             WHEN status <> (SELECT next_status FROM desired) THEN 1 ELSE 0 END,
           status_source = CASE
             WHEN status <> (SELECT next_status FROM desired) THEN ? ELSE status_source END,
           updated_at = CASE
             WHEN status <> (SELECT next_status FROM desired) THEN ? ELSE updated_at END
       WHERE id = ?
         AND session_id = ?
         AND status IN ('running', 'waiting_input')
         AND ${INSERTED_EVENT_FENCE}`,
    )
    .bind(
      record.sessionId,
      runId,
      record.createdAt,
      record.event.origin,
      record.createdAt,
      runId,
      record.sessionId,
      record.eventId,
      record.sessionId,
      record.event.kind,
    );
}

function preparePermissionProjectionGuard(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
  runId: SessionRunId,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO session_event (id)
       SELECT ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM session_event AS receipt
         INNER JOIN session_run AS run
           ON run.id = ? AND run.session_id = receipt.session_id
         WHERE receipt.id = ?
           AND receipt.session_id = ?
           AND receipt.event_type = ?
           AND run.status = CASE WHEN EXISTS (
             SELECT 1 FROM session_permission_request AS permission
             WHERE permission.session_id = receipt.session_id AND permission.run_id = run.id
           ) THEN 'waiting_input' ELSE 'running' END
       )`,
    )
    .bind(
      createPlatformId<RuntimeEventId>(),
      runId,
      record.eventId,
      record.sessionId,
      record.event.kind,
    );
}

function preparePermissionRequested(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): D1PreparedStatement[] {
  const request = readRuntimeEventPermissionRequest(record.event);
  if (request === null) {
    return [];
  }
  const runId = requirePermissionRunId(record);
  if (request.runId !== runId) {
    throw new Error("Permission request payload conflicts with its event Run identity.");
  }
  return [
    preparePermissionRequestUpsert(database, record, request),
    preparePermissionRunStatusUpdate(database, record, runId),
    preparePermissionProjectionGuard(database, record, runId),
  ];
}

function preparePermissionResolved(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): D1PreparedStatement[] {
  const payload = readRuntimeEventPayload(record.event);
  const requestId = readRuntimeEventString(payload, "requestId");
  if (requestId === null) {
    return [];
  }
  const runId = requirePermissionRunId(record);
  return [
    preparePermissionRequestDelete(database, record, runId, requestId),
    preparePermissionRunStatusUpdate(database, record, runId),
    preparePermissionProjectionGuard(database, record, runId),
  ];
}

function prepareReadinessUpsert(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): D1PreparedStatement {
  const readiness = parseSchemaValue(
    SessionReadinessSnapshotViewSchema,
    record.event.payload,
  ) satisfies SessionReadinessSnapshotView;

  return database
    .prepare(
      `INSERT INTO session_readiness_snapshot (readiness_json, session_id, updated_at)
       SELECT ?, ?, ?
        WHERE ${INSERTED_EVENT_FENCE}
       ON CONFLICT (session_id) DO UPDATE SET
         readiness_json = excluded.readiness_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      JSON.stringify(readiness),
      record.sessionId,
      record.createdAt,
      record.eventId,
      record.sessionId,
      record.event.kind,
    );
}

function prepareRunStarted(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): D1PreparedStatement[] {
  const runId = requirePermissionRunId(record);
  const run = readRuntimeRunPayload(record.event).run;
  const startedAt =
    run?.startedAt === null || run?.startedAt === undefined
      ? Number.NaN
      : Date.parse(run.startedAt);
  if (run === null || run.id !== runId || run.status !== "running" || !Number.isFinite(startedAt)) {
    throw new Error("Runtime run.started projection requires one exact running Run view.");
  }

  const update = database
    .prepare(
      `UPDATE session_run
       SET error_code = NULL,
           error_details_json = NULL,
           error_message = NULL,
           error_retryable = NULL,
           started_at = COALESCE(started_at, ?),
           status = CASE WHEN status IN ('queued', 'booting') THEN 'running' ELSE status END,
           status_changed_at = CASE
             WHEN status IN ('queued', 'booting') THEN ? ELSE status_changed_at END,
           status_event = CASE
             WHEN status IN ('queued', 'booting') THEN 'run.start' ELSE status_event END,
           status_operation_id = CASE
             WHEN status IN ('queued', 'booting') THEN NULL ELSE status_operation_id END,
           status_seq = status_seq + CASE WHEN status IN ('queued', 'booting') THEN 1 ELSE 0 END,
           status_source = CASE
             WHEN status IN ('queued', 'booting') THEN ? ELSE status_source END,
           updated_at = CASE
             WHEN status IN ('queued', 'booting') THEN ? ELSE updated_at END
       WHERE id = ?
         AND session_id = ?
         AND status IN ('queued', 'booting', 'running', 'waiting_input')
         AND ${INSERTED_EVENT_FENCE}`,
    )
    .bind(
      startedAt,
      record.createdAt,
      record.event.origin,
      record.createdAt,
      runId,
      record.sessionId,
      record.eventId,
      record.sessionId,
      record.event.kind,
    );
  const guard = database
    .prepare(
      `INSERT INTO session_event (id)
       SELECT ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM session_event AS receipt
         INNER JOIN session_run AS run
           ON run.id = ? AND run.session_id = receipt.session_id
         WHERE receipt.id = ?
           AND receipt.session_id = ?
           AND receipt.event_type = 'run.started'
           AND run.status IN ('running', 'waiting_input')
           AND run.started_at IS NOT NULL
       )`,
    )
    .bind(createPlatformId<RuntimeEventId>(), runId, record.eventId, record.sessionId);

  return [update, guard];
}

export function prepareSessionViewerRuntimeEventProjection(
  database: D1Database,
  record: SessionViewerProjectionRuntimeEvent,
): D1PreparedStatement[] {
  switch (record.event.kind) {
    case "permission.requested": {
      return preparePermissionRequested(database, record);
    }
    case "permission.resolved": {
      return preparePermissionResolved(database, record);
    }
    case "run.started": {
      return prepareRunStarted(database, record);
    }
    case "session.readiness.updated": {
      return [prepareReadinessUpsert(database, record)];
    }
    default: {
      return [];
    }
  }
}
