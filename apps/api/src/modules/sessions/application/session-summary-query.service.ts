import type {
  SessionListPageInfo,
  SessionStatus,
  SessionSummary,
  SessionSummaryConnection,
  SessionType,
} from "@mosoo/contracts/session";
import type { SessionRunStatus, SessionRunTrigger } from "@mosoo/contracts/session-run";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  OrganizationId,
  AppId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getSessionRunSummariesByIds,
  toSessionRunSummary,
} from "../../runtime/application/session-runs/session-run-summary.service";
import type { SessionRunRow } from "../../runtime/application/session-runs/session-run-summary.service";
import {
  sessionCreatorCondition,
  sessionCreatorFlag,
  sessionParticipantCondition,
  sessionParticipantFlag,
} from "../domain/session-access.policy";

export const SESSION_SUMMARY_LIST_LIMIT = 100;

interface SessionSummaryCursor {
  id: SessionId;
  updatedAt: number;
}

export interface SessionSummaryListOptions {
  beforeCursor?: string | null;
  limit?: number | null;
  type?: SessionType | null;
}

export interface SessionSummaryRow {
  agent_id: AgentId;
  archived_at: number | null;
  created_at: number;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  id: SessionId;
  kind: SessionSummary["kind"];
  last_message_at: number | null;
  last_run_id: SessionRunId | null;
  model: string;
  provider: string;
  app_id: AppId;
  runtime_id: string;
  status: SessionStatus;
  title: string | null;
  type: SessionType;
  updated_at: number;
  organization_id: OrganizationId;
}

export interface SessionSummaryWithLastRunRow extends SessionSummaryRow {
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

interface SessionSummaryAccessWithLastRunRow extends SessionSummaryWithLastRunRow {
  is_session_creator: number;
  is_session_participant: number;
}

interface ParticipantSessionSummaryAccessWithLastRunRow extends SessionSummaryWithLastRunRow {
  is_session_creator: number;
}

export interface SessionSummaryAccess {
  isSessionCreator: boolean;
  session: SessionSummary;
}

export interface SessionSummaryAccessConnection {
  nodes: SessionSummaryAccess[];
  pageInfo: SessionListPageInfo;
}

function normalizeSessionSummaryListLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined) {
    return SESSION_SUMMARY_LIST_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw validationError("Session list limit must be a positive integer.");
  }

  return Math.min(limit, SESSION_SUMMARY_LIST_LIMIT);
}

function encodeSessionSummaryCursor(row: { id: string; updated_at: number }): string {
  return `${row.updated_at}:${row.id}`;
}

function parseSessionSummaryCursor(cursor: string | null | undefined): SessionSummaryCursor | null {
  if (cursor === null || cursor === undefined || cursor.trim() === "") {
    return null;
  }

  const delimiterIndex = cursor.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex === cursor.length - 1) {
    throw validationError("Session list cursor is invalid.");
  }

  const updatedAt = Number(cursor.slice(0, delimiterIndex));
  const id = cursor.slice(delimiterIndex + 1);

  if (!Number.isInteger(updatedAt) || updatedAt < 0 || id.trim() === "") {
    throw validationError("Session list cursor is invalid.");
  }

  return { id: parsePlatformId<SessionId>(id, "Session list cursor ID"), updatedAt };
}

function sessionSummaryCursorFilter(cursor: SessionSummaryCursor): SQL {
  return or(
    lt(sessionsTable.updatedAt, cursor.updatedAt),
    and(eq(sessionsTable.updatedAt, cursor.updatedAt), lt(sessionsTable.id, cursor.id)),
  )!;
}

export async function listSessionSummaryConnection(input: {
  beforeCursor?: string | null;
  database: D1Database;
  filters: readonly SQL[];
  limit?: number | null;
}): Promise<SessionSummaryConnection> {
  const limit = normalizeSessionSummaryListLimit(input.limit);
  const beforeCursor = parseSessionSummaryCursor(input.beforeCursor);
  const filters = [...input.filters];

  if (beforeCursor !== null) {
    filters.push(sessionSummaryCursorFilter(beforeCursor));
  }

  const rows = await getAppDatabase(input.database)
    .select(sessionSummaryWithLastRunColumns())
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .where(and(...filters))
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.id))
    .limit(limit + 1)
    .all();
  const nodeRows = rows.slice(0, limit);
  const firstRow = nodeRows[0] ?? null;
  const lastRow = nodeRows.at(-1) ?? null;

  return {
    nodes: nodeRows.map(buildSessionSummaryFromJoinedRow),
    pageInfo: {
      endCursor: lastRow === null ? null : encodeSessionSummaryCursor(lastRow),
      hasMore: rows.length > limit,
      startCursor: firstRow === null ? null : encodeSessionSummaryCursor(firstRow),
    },
  };
}

export async function listSessionSummaryAccessConnection(input: {
  beforeCursor?: string | null;
  database: D1Database;
  filters: readonly SQL[];
  limit?: number | null;
  viewerId: AccountId;
}): Promise<SessionSummaryAccessConnection> {
  const limit = normalizeSessionSummaryListLimit(input.limit);
  const beforeCursor = parseSessionSummaryCursor(input.beforeCursor);
  const filters = [...input.filters];

  if (beforeCursor !== null) {
    filters.push(sessionSummaryCursorFilter(beforeCursor));
  }

  const rows = await getAppDatabase(input.database)
    .select(sessionSummaryAccessWithLastRunColumns(input.viewerId))
    .from(sessionsTable)
    .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
    .where(and(...filters))
    .orderBy(desc(sessionsTable.updatedAt), desc(sessionsTable.id))
    .limit(limit + 1)
    .all();
  const nodeRows = rows.slice(0, limit);
  const firstRow = nodeRows[0] ?? null;
  const lastRow = nodeRows.at(-1) ?? null;

  return {
    nodes: nodeRows.map(buildSessionSummaryAccessFromJoinedRow),
    pageInfo: {
      endCursor: lastRow === null ? null : encodeSessionSummaryCursor(lastRow),
      hasMore: rows.length > limit,
      startCursor: firstRow === null ? null : encodeSessionSummaryCursor(firstRow),
    },
  };
}

export function sessionSummaryColumns() {
  return {
    agent_id: sessionsTable.agentId,
    archived_at: sessionsTable.archivedAt,
    created_at: sql`${sessionsTable.createdAt}`.mapWith(sessionsTable.createdAt).as("created_at"),
    deployment_version_id: sql`${sessionsTable.deploymentVersionId}`
      .mapWith(sessionsTable.deploymentVersionId)
      .as("deployment_version_id"),
    deployment_version_number: sql`${sessionsTable.deploymentVersionNumber}`
      .mapWith(sessionsTable.deploymentVersionNumber)
      .as("deployment_version_number"),
    id: sql`${sessionsTable.id}`.mapWith(sessionsTable.id).as("id"),
    kind: sessionsTable.kind,
    last_message_at: sessionsTable.lastMessageAt,
    last_run_id: sessionsTable.lastRunId,
    model: sql`${sessionsTable.model}`.mapWith(sessionsTable.model).as("model"),
    organization_id: sessionsTable.organizationId,
    provider: sql`${sessionsTable.provider}`.mapWith(sessionsTable.provider).as("provider"),
    app_id: sessionsTable.appId,
    runtime_id: sessionsTable.runtimeId,
    status: sql`${sessionsTable.status}`.mapWith(sessionsTable.status).as("status"),
    title: sessionsTable.title,
    type: sessionsTable.type,
    updated_at: sql`${sessionsTable.updatedAt}`.mapWith(sessionsTable.updatedAt).as("updated_at"),
  };
}

export function sessionSummaryWithLastRunColumns() {
  return {
    ...sessionSummaryColumns(),
    run_completed_at: sessionRunsTable.completedAt,
    run_created_at: sql`${sessionRunsTable.createdAt}`
      .mapWith(sessionRunsTable.createdAt)
      .as("run_created_at"),
    run_deployment_version_id: sql`${sessionRunsTable.deploymentVersionId}`
      .mapWith(sessionRunsTable.deploymentVersionId)
      .as("run_deployment_version_id"),
    run_deployment_version_number: sql`${sessionRunsTable.deploymentVersionNumber}`
      .mapWith(sessionRunsTable.deploymentVersionNumber)
      .as("run_deployment_version_number"),
    run_error_code: sessionRunsTable.errorCode,
    run_error_details_json: sessionRunsTable.errorDetailsJson,
    run_error_message: sessionRunsTable.errorMessage,
    run_id: sql`${sessionRunsTable.id}`.mapWith(sessionRunsTable.id).as("run_id"),
    run_model: sql`${sessionRunsTable.model}`.mapWith(sessionRunsTable.model).as("run_model"),
    run_provider: sql`${sessionRunsTable.provider}`
      .mapWith(sessionRunsTable.provider)
      .as("run_provider"),
    run_started_at: sessionRunsTable.startedAt,
    run_status: sql`${sessionRunsTable.status}`.mapWith(sessionRunsTable.status).as("run_status"),
    run_trace_id: sessionRunsTable.traceId,
    run_trigger: sessionRunsTable.trigger,
    run_updated_at: sql`${sessionRunsTable.updatedAt}`
      .mapWith(sessionRunsTable.updatedAt)
      .as("run_updated_at"),
  };
}

function sessionSummaryAccessWithLastRunColumns(viewerId: AccountId) {
  return {
    ...sessionSummaryWithLastRunColumns(),
    is_session_creator: sessionCreatorFlag(viewerId).as("is_session_creator"),
    is_session_participant: sessionParticipantFlag(viewerId).as("is_session_participant"),
  };
}

function participantSessionSummaryAccessWithLastRunColumns(viewerId: AccountId) {
  return {
    ...sessionSummaryWithLastRunColumns(),
    is_session_creator: sessionCreatorFlag(viewerId).as("is_session_creator"),
  };
}

function buildSessionSummaryFromRow(
  row: SessionSummaryRow,
  lastRun: SessionSummary["lastRun"],
): SessionSummary {
  return {
    agentId: row.agent_id,
    archivedAt: row.archived_at === null ? null : toIsoString(row.archived_at),
    createdAt: toIsoString(row.created_at),
    deploymentVersionId: row.deployment_version_id,
    deploymentVersionNumber: row.deployment_version_number,
    id: row.id,
    kind: row.kind,
    lastMessageAt: row.last_message_at === null ? null : toIsoString(row.last_message_at),
    lastRun,
    model: row.model,
    organizationId: row.organization_id,
    provider: row.provider,
    appId: row.app_id,
    runtimeId: row.runtime_id,
    status: row.status,
    title: row.title,
    type: row.type,
    updatedAt: toIsoString(row.updated_at),
  };
}

export function buildSessionSummaryFromJoinedRow(
  row: SessionSummaryWithLastRunRow,
): SessionSummary {
  return buildSessionSummaryFromRow(row, toJoinedSessionRunSummary(row));
}

export async function hydrateSessionSummariesFromRows(
  database: D1Database,
  rows: readonly SessionSummaryRow[],
): Promise<SessionSummary[]> {
  const runIds = rows.flatMap((row) => (row.last_run_id === null ? [] : [row.last_run_id]));
  const runsById = await getSessionRunSummariesByIds(database, runIds);

  return rows.map((row) =>
    buildSessionSummaryFromRow(
      row,
      row.last_run_id === null ? null : (runsById.get(row.last_run_id) ?? null),
    ),
  );
}

function buildSessionSummaryAccessFromJoinedRow(
  row: SessionSummaryAccessWithLastRunRow | ParticipantSessionSummaryAccessWithLastRunRow,
): SessionSummaryAccess {
  return {
    isSessionCreator: row.is_session_creator === 1,
    session: buildSessionSummaryFromJoinedRow(row),
  };
}

export async function getSessionSummaryAccessById(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummaryAccess> {
  await ensureAppOwnership(database, viewerId, input.appId);
  const row =
    (await getAppDatabase(database)
      .select(sessionSummaryAccessWithLastRunColumns(viewerId))
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.appId, input.appId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Session not found.");
  }

  if (row.is_session_participant !== 1) {
    await ensureAppAgentOwner(database, viewerId, {
      agentId: row.agent_id,
      appId: input.appId,
    });
  }

  return buildSessionSummaryAccessFromJoinedRow(row);
}

export async function getSessionSummaryById(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummary> {
  return (await getSessionSummaryAccessById(database, viewerId, input)).session;
}

export async function getParticipantSessionSummaryById(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummary> {
  await ensureAppOwnership(database, viewerId, input.appId);
  const row =
    (await getAppDatabase(database)
      .select(sessionSummaryWithLastRunColumns())
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.appId, input.appId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return buildSessionSummaryFromJoinedRow(row);
}

export async function getParticipantSessionSummaryAccessById(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummaryAccess> {
  await ensureAppOwnership(database, viewerId, input.appId);
  const row =
    (await getAppDatabase(database)
      .select(participantSessionSummaryAccessWithLastRunColumns(viewerId))
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.appId, input.appId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return buildSessionSummaryAccessFromJoinedRow(row);
}

export async function getSessionSummaryForCreator(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummary> {
  await ensureAppOwnership(database, viewerId, input.appId);
  const row =
    (await getAppDatabase(database)
      .select(sessionSummaryWithLastRunColumns())
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.appId, input.appId),
          sessionCreatorCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Session not found.");
  }

  return buildSessionSummaryFromJoinedRow(row);
}

export async function listSessions(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SessionSummaryListOptions & {
    archived?: boolean | null;
    appId: AppId;
  },
): Promise<SessionSummaryConnection> {
  const archived = input.archived ?? false;
  await ensureAppOwnership(database, viewer.id, input.appId);

  const filters: SQL[] = [
    eq(sessionsTable.appId, input.appId),
    sessionParticipantCondition(viewer.id),
    archived ? isNotNull(sessionsTable.archivedAt) : isNull(sessionsTable.archivedAt),
  ];

  if (input.type !== undefined && input.type !== null) {
    filters.push(eq(sessionsTable.type, input.type));
  }

  return listSessionSummaryConnection({
    beforeCursor: input.beforeCursor ?? null,
    database,
    filters,
    limit: input.limit ?? null,
  });
}

export async function getSession(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionSummary> {
  return getSessionSummaryById(database, viewer.id, input);
}

function requireJoinedRunValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw new Error(`Joined session run is missing ${fieldName}.`);
  }

  return value;
}

function toJoinedSessionRunSummary(row: SessionSummaryWithLastRunRow): SessionSummary["lastRun"] {
  if (row.run_id === null) {
    return null;
  }

  const runRow: SessionRunRow = {
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
  };

  return toSessionRunSummary(runRow);
}
