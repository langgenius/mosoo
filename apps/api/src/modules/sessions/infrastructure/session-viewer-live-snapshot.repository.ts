import type {
  SessionLiveState,
  SessionPermissionRequestView,
  SessionRunView,
} from "@mosoo/ag-ui-session";
import { createInitialSessionLiveState } from "@mosoo/ag-ui-session";
import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionPermissionRequestsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type { PlatformId, SessionId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { fileStore } from "../../files/application/file-store";
import { isTerminalSessionRunStatus } from "../../runtime/domain/session-run-lifecycle.machine";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../application/session-summary-query.service";
import { listSessionMessages } from "./session-message-snapshot.repository";

async function listPermissionRequests(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionPermissionRequestView[]> {
  return getAppDatabase(database)
    .select({
      driverInstanceId: sessionPermissionRequestsTable.driverInstanceId,
      rawInput: sessionPermissionRequestsTable.rawInput,
      requestId: sessionPermissionRequestsTable.requestId,
      runId: sessionPermissionRequestsTable.runId,
      title: sessionPermissionRequestsTable.title,
      toolCallId: sessionPermissionRequestsTable.toolCallId,
      toolKind: sessionPermissionRequestsTable.toolKind,
    })
    .from(sessionPermissionRequestsTable)
    .where(eq(sessionPermissionRequestsTable.sessionId, sessionId))
    .orderBy(
      asc(sessionPermissionRequestsTable.createdAt),
      asc(sessionPermissionRequestsTable.requestId),
    )
    .all();
}

function toRunView(run: SessionRunSummary | null): SessionRunView {
  if (!run) {
    return {
      completedAt: null,
      error: null,
      id: null,
      startedAt: null,
      status: "idle",
      traceId: null,
    };
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

export async function loadSessionViewerState(
  database: D1Database,
  input: {
    sessionId: SessionId;
    viewerId: PlatformId;
  },
): Promise<SessionLiveState> {
  const [sessionRow, messages, permissionRequests, files] = await Promise.all([
    getAppDatabase(database)
      .select(sessionSummaryWithLastRunColumns())
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get(),
    listSessionMessages(database, input.sessionId),
    listPermissionRequests(database, input.sessionId),
    fileStore.listReadySessionFiles(database, input.sessionId),
  ]);

  if (sessionRow === undefined) {
    throw new Error("Session not found.");
  }

  const session = buildSessionSummaryFromJoinedRow(sessionRow);
  const latestRun = session.lastRun;
  const run = toRunView(latestRun);

  return {
    ...createInitialSessionLiveState({
      sessionId: input.sessionId,
      title: session.title,
      viewerId: input.viewerId,
    }),
    files,
    lifecycle: toCanonicalLifecycleStatus(session.status, run.status),
    messages: messages.map((message) => ({
      content: message.content,
      createdAt: message.createdAt,
      id: message.id,
      plan: message.plan,
      role: message.role,
      segments: message.segments,
    })),
    permissionRequests:
      latestRun === null || isTerminalSessionRunStatus(latestRun.status)
        ? []
        : permissionRequests.filter((request) => request.runId === latestRun.id),
    run,
    updatedAt: session.updatedAt,
  };
}
