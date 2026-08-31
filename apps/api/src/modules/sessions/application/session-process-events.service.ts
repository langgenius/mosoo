import {
  createNoRuntimeEventsRecordedEventId,
  createProcessEventsTruncatedEventId,
} from "@mosoo/contracts/session";
import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import type { AccountId, ProjectId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, lt } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getProjectSessionParticipantTimelineAccess } from "../domain/session-access.policy";
import {
  excludeSessionEventStreams,
  findLeftIncompleteSessionEventStreamKeys,
  foldStreamedSessionEventRows,
  getSessionEventStreamKey,
} from "../domain/session-event-stream-fold";
import { formatStoredSessionEventContent } from "../domain/session-event-tool-content";
import type { StoredToolStatus } from "../domain/session-event-tool-content";

export interface SessionEventProcessRow {
  content_text: string;
  ended_at: number;
  event_type: string;
  id: RuntimeEventId;
  occurred_at: number;
  process_status: SessionProcessEvent["status"];
  process_type: SessionProcessEvent["type"];
  run_id: SessionRunId | null;
  seq: number;
  stream_id: string | null;
  tool_name?: string | null;
  tool_status?: StoredToolStatus | null;
  tokens: number | null;
}

const DEFAULT_PROCESS_EVENT_LIMIT = 500;
const MAX_PROCESS_EVENT_LIMIT = 1000;
const PROCESS_EVENT_ROW_PAGE_SIZE = MAX_PROCESS_EVENT_LIMIT + 1;
const PROCESS_EVENT_RAW_ROW_SCAN_LIMIT = MAX_PROCESS_EVENT_LIMIT * 20;
// Longer gaps may be permission or user waits, not continuous execution.
const MAX_INFERRED_PROCESS_EVENT_DURATION_MS = 5 * 60 * 1000;

interface ProcessEventProjection {
  event: SessionProcessEvent;
  endMs: number;
  order: number;
  runId: SessionRunId | null;
  startMs: number;
}

interface SessionProcessEventAccess {
  id: SessionId;
  updatedAt: string;
}

interface SessionProcessEventWindow {
  events: SessionProcessEvent[];
  recorded: boolean;
  truncated: boolean;
}

function normalizeProcessEventLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined) {
    return DEFAULT_PROCESS_EVENT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw validationError("Process event limit must be a positive integer.");
  }

  return Math.min(limit, MAX_PROCESS_EVENT_LIMIT);
}

function finalizeProcessEventDurations(
  projections: ProcessEventProjection[],
): SessionProcessEvent[] {
  const sortedProjections = projections.toSorted((a, b) => a.order - b.order);

  return sortedProjections.map((projection, index) => {
    const next = sortedProjections[index + 1] ?? null;
    const inferredDurationMs = next === null ? 0 : next.startMs - projection.startMs;
    const canInferDuration =
      projection.runId !== null &&
      next?.runId === projection.runId &&
      inferredDurationMs >= 0 &&
      inferredDurationMs <= MAX_INFERRED_PROCESS_EVENT_DURATION_MS;
    const durationMs =
      projection.endMs > projection.startMs
        ? projection.endMs - projection.startMs
        : canInferDuration
          ? inferredDurationMs
          : 0;

    return {
      content: projection.event.content,
      durationMs,
      id: projection.event.id,
      occurredAt: projection.event.occurredAt,
      status: projection.event.status,
      tokens: projection.event.tokens,
      type: projection.event.type,
    };
  });
}

export function createSessionProcessEventsFromSessionEventRows(
  rows: SessionEventProcessRow[],
): SessionProcessEvent[] {
  const foldedRows = foldStreamedSessionEventRows(rows);
  const projections = foldedRows.map((row) => ({
    endMs: row.ended_at,
    event: {
      content: formatStoredSessionEventContent({
        contentText: row.content_text,
        eventType: row.event_type,
        toolName: row.tool_name ?? null,
        toolStatus: row.tool_status ?? null,
      }),
      durationMs: 0,
      id: row.id,
      occurredAt: toIsoString(row.occurred_at),
      status: row.process_status,
      tokens: row.tokens,
      type: row.process_type,
    },
    order: row.seq,
    runId: row.run_id,
    startMs: row.occurred_at,
  }));

  return finalizeProcessEventDurations(projections);
}

function createNoRuntimeEventsRecordedEvent(
  session: SessionProcessEventAccess,
): SessionProcessEvent {
  return {
    content: "No runtime events have been recorded for this thread.",
    durationMs: null,
    id: createNoRuntimeEventsRecordedEventId(session.id),
    occurredAt: session.updatedAt,
    status: "unsupported",
    tokens: null,
    type: "session.status",
  };
}

function createProcessEventsTruncatedEvent(input: {
  limit: number;
  occurredAt: string;
  sessionId: SessionId;
}): SessionProcessEvent {
  return {
    content: `Earlier runtime events are hidden; showing the latest ${input.limit} events.`,
    durationMs: 0,
    id: createProcessEventsTruncatedEventId(input.sessionId),
    occurredAt: input.occurredAt,
    status: "unsupported",
    tokens: null,
    type: "session.status",
  };
}

async function getThreadSessionProcessEventAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionProcessEventAccess> {
  const row = await getProjectSessionParticipantTimelineAccess(database, viewerId, input);

  return {
    id: row.id,
    updatedAt: toIsoString(row.updated_at),
  };
}

async function readSessionProcessEventWindow(input: {
  database: D1Database;
  limit: number;
  sessionId: SessionId;
}): Promise<SessionProcessEventWindow> {
  const scannedRows: SessionEventProcessRow[] = [];
  let beforeSeq: number | null = null;
  let reachedStart = false;

  while (scannedRows.length < PROCESS_EVENT_RAW_ROW_SCAN_LIMIT) {
    const rowCapacity = Math.min(
      PROCESS_EVENT_ROW_PAGE_SIZE,
      PROCESS_EVENT_RAW_ROW_SCAN_LIMIT - scannedRows.length,
    );
    const querySize = rowCapacity + 1;
    const filters = [
      eq(sessionEventsTable.sessionId, input.sessionId),
      eq(sessionEventsTable.visibility, "all_consumers"),
    ];

    if (beforeSeq !== null) {
      filters.push(lt(sessionEventsTable.seq, beforeSeq));
    }

    const page = await getAppDatabase(input.database)
      .select({
        content_text: sessionEventsTable.contentText,
        ended_at: sessionEventsTable.endedAt,
        event_type: sessionEventsTable.eventType,
        id: sessionEventsTable.id,
        occurred_at: sessionEventsTable.occurredAt,
        process_status: sessionEventsTable.processStatus,
        process_type: sessionEventsTable.processType,
        run_id: sessionEventsTable.runId,
        seq: sessionEventsTable.seq,
        stream_id: sessionEventsTable.streamId,
        tool_name: sessionEventsTable.toolName,
        tool_status: sessionEventsTable.toolStatus,
        tokens: sessionEventsTable.tokens,
      })
      .from(sessionEventsTable)
      .where(and(...filters))
      .orderBy(desc(sessionEventsTable.seq))
      .limit(querySize)
      .all();

    if (page.length === 0) {
      reachedStart = true;
      break;
    }

    const scannedPage = page.slice(0, rowCapacity);
    scannedRows.push(...scannedPage);
    beforeSeq = scannedPage[scannedPage.length - 1]?.seq ?? beforeSeq;
    const chronologicalRows = scannedRows.toReversed();
    const foldedRows = foldStreamedSessionEventRows(chronologicalRows);
    const events = createSessionProcessEventsFromSessionEventRows(chronologicalRows);

    if (events.length > input.limit) {
      const reachedDatabaseStart = page.length <= rowCapacity;
      const incompleteStreams = reachedDatabaseStart
        ? new Set<string>()
        : findLeftIncompleteSessionEventStreamKeys(chronologicalRows);
      const rowsByEventId = new Map(foldedRows.map((row) => [row.id, row]));
      const retainedStreamsAreComplete = events.slice(-input.limit).every((event) => {
        const row = rowsByEventId.get(event.id);
        const key = row === undefined ? null : getSessionEventStreamKey(row);
        return key === null || !incompleteStreams.has(key);
      });

      if (!retainedStreamsAreComplete) {
        continue;
      }

      return {
        events: events.slice(-input.limit),
        recorded: true,
        truncated: true,
      };
    }

    if (page.length <= rowCapacity) {
      reachedStart = true;
      break;
    }
  }

  const chronologicalRows = scannedRows.toReversed();
  const incompleteStreams = reachedStart
    ? new Set<string>()
    : findLeftIncompleteSessionEventStreamKeys(chronologicalRows);
  const completeRows = excludeSessionEventStreams(chronologicalRows, incompleteStreams);
  const events = createSessionProcessEventsFromSessionEventRows(completeRows);

  return {
    events: events.slice(-input.limit),
    recorded: scannedRows.length > 0,
    truncated: !reachedStart || events.length > input.limit,
  };
}

async function listSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    limit?: number | null;
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionProcessEvent[]> {
  const limit = normalizeProcessEventLimit(input.limit);
  const session = await getThreadSessionProcessEventAccess(database, viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const window = await readSessionProcessEventWindow({
    database,
    limit,
    sessionId: input.sessionId,
  });

  if (!window.recorded) {
    return [createNoRuntimeEventsRecordedEvent(session)];
  }

  if (!window.truncated) {
    return window.events;
  }

  const firstEvent = window.events[0] ?? null;

  return [
    createProcessEventsTruncatedEvent({
      limit,
      occurredAt: firstEvent?.occurredAt ?? session.updatedAt,
      sessionId: session.id,
    }),
    ...window.events,
  ];
}

export async function getSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  session: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
  options: {
    limit?: number | null;
  } = {},
): Promise<SessionProcessEvent[]> {
  return listSessionProcessEvents(database, viewer, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    projectId: session.projectId,
    sessionId: session.sessionId,
  });
}

export async function getThreadSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  session: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
  options: {
    limit?: number | null;
  } = {},
): Promise<SessionProcessEvent[]> {
  return listSessionProcessEvents(database, viewer, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    projectId: session.projectId,
    sessionId: session.sessionId,
  });
}
