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
  fileRecordsTable,
  sessionPermissionRequestsTable,
  sessionReadinessSnapshotsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { AgentDeploymentVersionId, PlatformId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import type { FileRecordRow } from "../../files/infrastructure/file-record-store";
import { fileRecordRowColumns, toSessionFile } from "../../files/infrastructure/file-record-store";
import { createInitialSessionLiveState } from "./session-live-state.reducer";
import { loadStoredSessionMessages } from "./session-message-snapshot.repository";

interface SessionViewerStateSessionRow {
  id: SessionId;
  status: SessionStatus;
  title: string | null;
  updated_at: number;
}

interface SessionViewerStateJoinedRow extends SessionViewerStateSessionRow {
  run_completed_at: number | null;
  run_created_at: number | null;
  run_deployment_version_id: AgentDeploymentVersionId | null;
  run_deployment_version_number: number | null;
  run_error_code: string | null;
  run_error_details_json: string | null;
  run_error_message: string | null;
  run_id: SessionRunId | null;
  run_model: string | null;
  run_provider: string | null;
  run_started_at: number | null;
  run_status: SessionRunStatus | null;
  run_trace_id: string | null;
  run_trigger: SessionRunTrigger | null;
  run_updated_at: number | null;
}

interface SessionViewerStateSnapshotRow {
  file: FileRecordRow | null;
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

async function listSessionViewerStateSnapshotRows(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionViewerStateSnapshotRow[]> {
  const rows = await getAppDatabase(database)
    .select({
      file: fileRecordRowColumns,
      session: {
        id: sessionsTable.id,
        run_completed_at: sessionRunsTable.completedAt,
        run_created_at: sessionRunsTable.createdAt,
        run_deployment_version_id: sessionRunsTable.deploymentVersionId,
        run_deployment_version_number: sessionRunsTable.deploymentVersionNumber,
        run_error_code: sessionRunsTable.errorCode,
        run_error_details_json: sessionRunsTable.errorDetailsJson,
        run_error_message: sessionRunsTable.errorMessage,
        run_id: sessionRunsTable.id,
        run_model: sessionRunsTable.model,
        run_provider: sessionRunsTable.provider,
        run_started_at: sessionRunsTable.startedAt,
        run_status: sessionRunsTable.status,
        run_trace_id: sessionRunsTable.traceId,
        run_trigger: sessionRunsTable.trigger,
        run_updated_at: sessionRunsTable.updatedAt,
        status: sessionsTable.status,
        title: sessionsTable.title,
        updated_at: sessionsTable.updatedAt,
      },
    })
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .leftJoin(
      fileRecordsTable,
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionsTable.id),
        eq(fileRecordsTable.status, "ready"),
      ),
    )
    .where(eq(sessionsTable.id, sessionId))
    .orderBy(desc(fileRecordsTable.createdAt))
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
    retryable: false,
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

function toJoinedSessionFile(row: SessionViewerStateSnapshotRow): SessionViewFile | null {
  const file = row.file;

  if (file === null) {
    return null;
  }

  return toSessionFile(file);
}

function collectJoinedSessionFiles(rows: SessionViewerStateSnapshotRow[]): SessionViewFile[] {
  return rows.flatMap((row) => {
    const file = toJoinedSessionFile(row);
    return file === null ? [] : [file];
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
    lifecycle: toCanonicalLifecycleStatus(input.session.status, run.status),
    permissionRequests,
    run,
    sessionId: input.session.id,
    title: input.session.title,
    updatedAt: toIsoString(input.session.updated_at),
    viewerId: input.viewerId,
  };
}

export async function loadSessionViewerState(
  database: D1Database,
  input: LoadSessionViewerStateInput,
): Promise<SessionLiveState> {
  const snapshotRowsPromise = listSessionViewerStateSnapshotRows(database, input.sessionId);
  const messagesPromise = loadStoredSessionMessages(database, input.sessionId);
  const permissionRequestsPromise = listActivePermissionRequests(database, input.sessionId);
  const readinessPromise = getLatestReadinessSnapshot(database, input.sessionId);
  const snapshotRows = await snapshotRowsPromise;
  const session = getFirstSnapshotRow(snapshotRows).session;
  const latestRun = toJoinedSessionRunSummary(session);
  const sessionFiles = collectJoinedSessionFiles(snapshotRows);
  const [messages, permissionRequests, readiness] = await Promise.all([
    messagesPromise,
    permissionRequestsPromise,
    readinessPromise,
  ]);
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
  };
  const state = applyCanonicalSessionState(stateWithMessages, {
    files: sessionFiles,
    latestRun,
    session,
    viewerId: input.viewerId,
  });

  return state;
}
