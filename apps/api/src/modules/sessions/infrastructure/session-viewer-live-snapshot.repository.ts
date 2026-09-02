import type {
  SessionLiveState,
  SessionPermissionRequestView,
  SessionReadinessSnapshotView,
  SessionRunView,
  SessionViewFile,
} from "@mosoo/ag-ui-session";
import { SessionReadinessSnapshotViewSchema } from "@mosoo/ag-ui-session";
import type { SessionStatus } from "@mosoo/contracts/session";
import type {
  RunError,
  SessionRunStatus,
  SessionRunSummary,
  SessionRunTrigger,
} from "@mosoo/contracts/session-run";
import {
  PrimitiveRecord as PrimitiveRecordSchema,
  parseSchemaValue,
} from "@mosoo/contracts/validation";
import {
  sessionAgentTaskSnapshotsTable,
  sessionPermissionRequestsTable,
  sessionReadinessSnapshotsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { AgentDeploymentVersionId, PlatformId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import { fileStore } from "../../files/application/file-store";
import { parseStoredAgentTaskSnapshot } from "./session-agent-task-snapshot.repository";
import { createInitialSessionLiveState } from "./session-live-state.reducer";
import { applyStoredSessionArtifacts } from "./session-message-reference.repository";
import { loadStoredSessionMessages } from "./session-message-snapshot.repository";

interface SessionViewerStateSessionRow {
  id: SessionId;
  runtime_event_seq_cursor: number;
  status: SessionStatus;
  title: string | null;
  updated_at: number;
}

interface SessionViewerStateJoinedRow extends SessionViewerStateSessionRow {
  run_completed_at: number | null;
  run_created_at: number | null;
  run_deployment_version_id: AgentDeploymentVersionId | null;
  run_deployment_version_number: number | null;
  run_driver_instance_id: string | null;
  run_error_code: string | null;
  run_error_details_json: string | null;
  run_error_message: string | null;
  run_error_retryable: boolean | null;
  run_id: SessionRunId | null;
  run_model: string | null;
  run_provider: string | null;
  run_started_at: number | null;
  run_status: SessionRunStatus | null;
  run_trace_id: string | null;
  run_trigger: SessionRunTrigger | null;
  run_updated_at: number | null;
  task_driver_instance_id: string | null;
  task_run_id: string | null;
  task_tasks_json: string | null;
}

interface SessionViewerStateSnapshotRow {
  session: SessionViewerStateJoinedRow;
}

interface SessionViewerStateRunRow {
  completed_at: number | null;
  created_at: number;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  error_code: string | null;
  error_details_json: string | null;
  error_message: string | null;
  error_retryable: boolean | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  session_id: SessionId;
  started_at: number | null;
  status: SessionRunStatus;
  trace_id: string;
  trigger: SessionRunTrigger;
  updated_at: number;
}

interface SessionViewerPermissionRequestRow {
  driver_instance_id: string;
  raw_input: string | null;
  request_id: string;
  run_id: string;
  title: string;
  tool_call_id: string | null;
  tool_kind: string | null;
}

export interface LoadSessionViewerStateInput {
  sessionId: SessionId;
  viewerId: PlatformId;
}

export interface LoadedSessionViewerState {
  runtimeEventSeqCursor: number;
  state: SessionLiveState;
}

const MAX_CONSISTENT_SNAPSHOT_ATTEMPTS = 5;

async function listSessionViewerStateSnapshotRows(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionViewerStateSnapshotRow[]> {
  const rows = await getAppDatabase(database)
    .select({
      session: {
        id: sessionsTable.id,
        run_completed_at: sessionRunsTable.completedAt,
        run_created_at: sessionRunsTable.createdAt,
        run_deployment_version_id: sessionRunsTable.deploymentVersionId,
        run_deployment_version_number: sessionRunsTable.deploymentVersionNumber,
        run_driver_instance_id: sessionRunsTable.driverInstanceId,
        run_error_code: sessionRunsTable.errorCode,
        run_error_details_json: sessionRunsTable.errorDetailsJson,
        run_error_message: sessionRunsTable.errorMessage,
        run_error_retryable: sessionRunsTable.errorRetryable,
        run_id: sessionRunsTable.id,
        run_model: sessionRunsTable.model,
        run_provider: sessionRunsTable.provider,
        run_started_at: sessionRunsTable.startedAt,
        run_status: sessionRunsTable.status,
        run_trace_id: sessionRunsTable.traceId,
        run_trigger: sessionRunsTable.trigger,
        run_updated_at: sessionRunsTable.updatedAt,
        runtime_event_seq_cursor: sessionsTable.runtimeEventSeqCursor,
        status: sessionsTable.status,
        task_driver_instance_id: sessionAgentTaskSnapshotsTable.driverInstanceId,
        task_run_id: sessionAgentTaskSnapshotsTable.runId,
        task_tasks_json: sessionAgentTaskSnapshotsTable.tasksJson,
        title: sessionsTable.title,
        updated_at: sessionsTable.updatedAt,
      },
    })
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .leftJoin(
      sessionAgentTaskSnapshotsTable,
      and(
        eq(sessionAgentTaskSnapshotsTable.sessionId, sessionsTable.id),
        eq(sessionAgentTaskSnapshotsTable.runId, sessionRunsTable.id),
        eq(sessionAgentTaskSnapshotsTable.driverInstanceId, sessionRunsTable.driverInstanceId),
        isNull(sessionsTable.archivedAt),
      ),
    )
    .where(eq(sessionsTable.id, sessionId))
    .limit(1)
    .all();

  if (rows.length === 0) {
    throw new Error("Session not found.");
  }

  return rows;
}

function getFirstSnapshotRow(rows: SessionViewerStateSnapshotRow[]): SessionViewerStateSnapshotRow {
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Session not found.");
  }

  return row;
}

function parseJsonRecord(raw: string | null): RunError["details"] {
  if (raw === null) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  return parseSchemaValue(PrimitiveRecordSchema, parsed);
}

function parseReadinessSnapshot(raw: string): SessionReadinessSnapshotView {
  const parsed: unknown = JSON.parse(raw);
  return parseSchemaValue(SessionReadinessSnapshotViewSchema, parsed);
}

function toPermissionRequestView(
  row: SessionViewerPermissionRequestRow,
): SessionPermissionRequestView {
  return {
    driverInstanceId: row.driver_instance_id,
    rawInput: row.raw_input,
    requestId: row.request_id,
    runId: row.run_id,
    title: row.title,
    toolCallId: row.tool_call_id,
    toolKind: row.tool_kind,
  };
}

async function listActivePermissionRequests(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionPermissionRequestView[]> {
  const rows = await getAppDatabase(database)
    .select({
      driver_instance_id: sessionPermissionRequestsTable.driverInstanceId,
      raw_input: sessionPermissionRequestsTable.rawInput,
      request_id: sessionPermissionRequestsTable.requestId,
      run_id: sessionPermissionRequestsTable.runId,
      title: sessionPermissionRequestsTable.title,
      tool_call_id: sessionPermissionRequestsTable.toolCallId,
      tool_kind: sessionPermissionRequestsTable.toolKind,
    })
    .from(sessionPermissionRequestsTable)
    .where(eq(sessionPermissionRequestsTable.sessionId, sessionId))
    .orderBy(
      asc(sessionPermissionRequestsTable.createdAt),
      asc(sessionPermissionRequestsTable.requestId),
    )
    .all();

  return rows.map(toPermissionRequestView);
}

async function getLatestReadinessSnapshot(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionReadinessSnapshotView | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        readiness_json: sessionReadinessSnapshotsTable.readinessJson,
      })
      .from(sessionReadinessSnapshotsTable)
      .where(eq(sessionReadinessSnapshotsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null;

  return row === null ? null : parseReadinessSnapshot(row.readiness_json);
}

function toRunError(row: SessionViewerStateRunRow): RunError | null {
  if (!isTruthy(row.error_code) || !isTruthy(row.error_message)) {
    return null;
  }

  return {
    code: row.error_code,
    details: parseJsonRecord(row.error_details_json),
    message: row.error_message,
    retryable: row.error_retryable ?? false,
  };
}

function toSessionRunSummary(row: SessionViewerStateRunRow): SessionRunSummary {
  return {
    completedAt: row.completed_at === null ? null : toIsoString(row.completed_at),
    createdAt: toIsoString(row.created_at),
    deploymentVersionId: row.deployment_version_id,
    deploymentVersionNumber: row.deployment_version_number,
    error: toRunError(row),
    id: row.id,
    model: row.model,
    provider: row.provider,
    startedAt: row.started_at === null ? null : toIsoString(row.started_at),
    status: row.status,
    traceId: row.trace_id,
    trigger: row.trigger,
    updatedAt: toIsoString(row.updated_at),
  };
}

function requireJoinedRunValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw new Error(`Joined session run is missing ${fieldName}.`);
  }

  return value;
}

function toJoinedSessionRunSummary(row: SessionViewerStateJoinedRow): SessionRunSummary | null {
  if (row.run_id === null) {
    return null;
  }

  return toSessionRunSummary({
    completed_at: row.run_completed_at,
    created_at: requireJoinedRunValue(row.run_created_at, "created_at"),
    deployment_version_id: row.run_deployment_version_id,
    deployment_version_number: row.run_deployment_version_number,
    error_code: row.run_error_code,
    error_details_json: row.run_error_details_json,
    error_message: row.run_error_message,
    error_retryable: row.run_error_retryable,
    id: row.run_id,
    model: row.run_model,
    provider: row.run_provider,
    session_id: row.id,
    started_at: row.run_started_at,
    status: requireJoinedRunValue(row.run_status, "status"),
    trace_id: requireJoinedRunValue(row.run_trace_id, "trace_id"),
    trigger: requireJoinedRunValue(row.run_trigger, "trigger"),
    updated_at: requireJoinedRunValue(row.run_updated_at, "updated_at"),
  });
}

function toIdleRunView(): SessionRunView {
  return {
    completedAt: null,
    error: null,
    id: null,
    startedAt: null,
    status: "idle",
    traceId: null,
  };
}

function toRunView(run: SessionRunSummary | null): SessionRunView {
  if (!run) {
    return toIdleRunView();
  }

  return {
    completedAt: run.completedAt,
    error: run.error,
    id: run.id,
    startedAt: run.startedAt,
    status: run.status,
    traceId: run.traceId,
  };
}

function isTerminalRunStatus(status: SessionRunView["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired"
  );
}

function toJoinedAgentTaskSnapshot(
  row: SessionViewerStateJoinedRow,
): SessionLiveState["taskSnapshot"] {
  if (
    row.status !== "RUNNING" ||
    row.run_status === null ||
    isTerminalRunStatus(row.run_status) ||
    row.task_driver_instance_id === null ||
    row.task_run_id === null ||
    row.task_tasks_json === null
  ) {
    return null;
  }

  return parseStoredAgentTaskSnapshot({
    driverInstanceId: row.task_driver_instance_id,
    runId: row.task_run_id,
    sessionId: row.id,
    tasksJson: row.task_tasks_json,
  });
}

function toCanonicalLifecycleStatus(
  sessionStatus: SessionStatus,
  runStatus: SessionRunView["status"],
): SessionLiveState["lifecycle"] {
  if (
    runStatus === "queued" ||
    runStatus === "booting" ||
    runStatus === "running" ||
    runStatus === "waiting_input"
  ) {
    return "RUNNING";
  }

  return sessionStatus;
}

function applyCanonicalSessionState(
  state: SessionLiveState,
  input: {
    files: SessionViewFile[];
    latestRun: SessionRunSummary | null;
    runDriverInstanceId: string | null;
    session: SessionViewerStateSessionRow;
    viewerId: PlatformId;
  },
): SessionLiveState {
  const run = toRunView(input.latestRun);
  const permissionRequests =
    isTerminalRunStatus(run.status) || run.id === null
      ? []
      : state.permissionRequests.filter((request) => request.runId === run.id);

  return {
    ...state,
    files: input.files,
    infra: {
      ...state.infra,
      driverInstanceId:
        input.session.status === "RUNNING" && !isTerminalRunStatus(run.status)
          ? input.runDriverInstanceId
          : null,
    },
    lifecycle: toCanonicalLifecycleStatus(input.session.status, run.status),
    permissionRequests,
    run,
    sessionId: input.session.id,
    title: input.session.title,
    updatedAt: toIsoString(input.session.updated_at),
    viewerId: input.viewerId,
  };
}

async function loadSessionViewerStateSnapshotOnce(
  database: D1Database,
  input: LoadSessionViewerStateInput,
): Promise<LoadedSessionViewerState> {
  const snapshotRows = await listSessionViewerStateSnapshotRows(database, input.sessionId);
  const session = getFirstSnapshotRow(snapshotRows).session;
  const messagesPromise = loadStoredSessionMessages(database, input.sessionId);
  const permissionRequestsPromise = listActivePermissionRequests(database, input.sessionId);
  const readinessPromise = getLatestReadinessSnapshot(database, input.sessionId);
  const sessionFilesPromise = fileStore.listReadySessionFiles(database, input.sessionId);
  const [messages, permissionRequests, readiness, sessionFiles] = await Promise.all([
    messagesPromise,
    permissionRequestsPromise,
    readinessPromise,
    sessionFilesPromise,
  ]);
  const latestRun = toJoinedSessionRunSummary(session);
  const taskSnapshot = toJoinedAgentTaskSnapshot(session);
  const baseState = createInitialSessionLiveState({
    sessionId: input.sessionId,
    title: session.title,
    viewerId: input.viewerId,
  });
  const stateWithMessages = {
    ...baseState,
    messages,
    permissionRequests,
    readiness,
    taskSnapshot,
  };
  const state = applyCanonicalSessionState(stateWithMessages, {
    files: sessionFiles,
    latestRun,
    runDriverInstanceId: session.run_driver_instance_id,
    session,
    viewerId: input.viewerId,
  });

  const resolvedState =
    session.runtime_event_seq_cursor === 0
      ? state
      : await applyStoredSessionArtifacts(database, {
          endSeq: session.runtime_event_seq_cursor,
          includeActiveRunArtifacts: latestRun !== null && !isTerminalRunStatus(latestRun.status),
          runId: latestRun?.id ?? null,
          sessionId: input.sessionId,
          state,
        });

  return {
    runtimeEventSeqCursor: session.runtime_event_seq_cursor,
    state: resolvedState,
  };
}

export async function loadSessionViewerStateSnapshot(
  database: D1Database,
  input: LoadSessionViewerStateInput,
): Promise<LoadedSessionViewerState> {
  for (let attempt = 0; attempt < MAX_CONSISTENT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const snapshot = await loadSessionViewerStateSnapshotOnce(database, input);
    const current = await getAppDatabase(database)
      .select({ runtimeEventSeqCursor: sessionsTable.runtimeEventSeqCursor })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get();

    if (current === undefined) {
      throw new Error("Session not found.");
    }
    if (current.runtimeEventSeqCursor === snapshot.runtimeEventSeqCursor) {
      return snapshot;
    }
  }

  throw new Error("Session changed while its viewer state snapshot was loading.");
}

export async function loadSessionViewerState(
  database: D1Database,
  input: LoadSessionViewerStateInput,
): Promise<SessionLiveState> {
  return (await loadSessionViewerStateSnapshot(database, input)).state;
}
