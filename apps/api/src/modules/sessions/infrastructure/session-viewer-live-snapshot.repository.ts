import type {
  SessionLiveState,
  SessionPermissionRequestView,
  SessionRunView,
  SessionViewMessage,
} from "@mosoo/ag-ui-session";
import {
  applyAgUiEventToSessionLiveState,
  createInitialSessionLiveState,
  createServerCustomEvent,
  EventType,
  MOSOO_CUSTOM_EVENT,
} from "@mosoo/ag-ui-session";
import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  sessionEventsTable,
  sessionPermissionRequestsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { PlatformId, SessionId } from "@mosoo/id";
import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import { fileStore } from "../../files/application/file-store";
import { isTerminalSessionRunStatus } from "../../runtime/domain/session-run-lifecycle.machine";
import {
  buildSessionSummaryFromJoinedRow,
  sessionSummaryWithLastRunColumns,
} from "../application/session-summary-query.service";
import { readStoredThoughtEvent } from "../domain/session-event-stream-fold";
import { listSessionMessages } from "./session-message-snapshot.repository";

// Each content chunk is capped at 512 KiB, keeping raw replay pages near 8 MiB.
const REASONING_REPLAY_PAGE_SIZE = 16;

async function listSessionReasoningMessages(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionViewMessage[]> {
  let state = createInitialSessionLiveState({ sessionId, title: null, viewerId: "" });
  let afterSeq = 0;
  const createdAtByThought = new Map<string, string>();

  for (;;) {
    const rows = await getAppDatabase(database)
      .select({
        canonical_event_json: sessionEventsTable.canonicalEventJson,
        event_type: sessionEventsTable.eventType,
        id: sessionEventsTable.id,
        occurred_at: sessionEventsTable.occurredAt,
        seq: sessionEventsTable.seq,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, sessionId),
          eq(sessionEventsTable.visibility, "all_consumers"),
          gt(sessionEventsTable.seq, afterSeq),
          isNotNull(sessionEventsTable.canonicalEventJson),
          inArray(sessionEventsTable.eventType, [
            "thought.started",
            "thought.updated",
            "thought.completed",
            "thought.cancelled",
          ]),
        ),
      )
      .orderBy(asc(sessionEventsTable.seq))
      .limit(REASONING_REPLAY_PAGE_SIZE)
      .all();

    for (const row of rows) {
      const thought = readStoredThoughtEvent(row);
      if (thought === null) continue;
      if (!createdAtByThought.has(thought.thoughtId)) {
        createdAtByThought.set(thought.thoughtId, toIsoString(row.occurred_at));
      }
      if (thought.offset !== null) {
        state = applyAgUiEventToSessionLiveState(
          state,
          createServerCustomEvent(MOSOO_CUSTOM_EVENT.sessionReasoningUpdated.name, {
            content: thought.content,
            messageId: thought.thoughtId,
            offset: thought.offset,
          }),
        );
      } else if (row.event_type !== "thought.started") {
        state = applyAgUiEventToSessionLiveState(state, {
          messageId: thought.thoughtId,
          type: EventType.REASONING_MESSAGE_END,
        });
        if (!state.messages.some((message) => message.id === thought.thoughtId)) {
          createdAtByThought.delete(thought.thoughtId);
        }
      }
    }
    if (rows.length < REASONING_REPLAY_PAGE_SIZE) break;
    afterSeq = rows.at(-1)!.seq;
  }

  return state.messages.map((message) =>
    Object.assign(message, { createdAt: createdAtByThought.get(message.id)! }),
  );
}

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
  const [sessionRow, messages, reasoningMessages, permissionRequests, files] = await Promise.all([
    getAppDatabase(database)
      .select(sessionSummaryWithLastRunColumns())
      .from(sessionsTable)
      .leftJoin(sessionRunsTable, eq(sessionRunsTable.id, sessionsTable.lastRunId))
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get(),
    listSessionMessages(database, input.sessionId),
    listSessionReasoningMessages(database, input.sessionId),
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
    messages: [
      ...messages.map((message) => ({
        content: message.content,
        createdAt: message.createdAt,
        id: message.id,
        plan: message.plan,
        role: message.role,
        segments: message.segments,
      })),
      ...reasoningMessages,
    ].toSorted((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
    permissionRequests:
      latestRun === null || isTerminalSessionRunStatus(latestRun.status)
        ? []
        : permissionRequests.filter((request) => request.runId === latestRun.id),
    run,
    updatedAt: session.updatedAt,
  };
}
