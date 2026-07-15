import {
  createNoRuntimeEventsRecordedEventId,
  createProcessEventsTruncatedEventId,
} from "@mosoo/contracts/session";
import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { sessionEventsTable } from "@mosoo/db";
import type { AccountId, AppId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getAppSessionParticipantTimelineAccess } from "../domain/session-access.policy";
import { foldStreamedSessionEventRows } from "../domain/session-event-stream-fold";

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
  tokens: number | null;
}

const DEFAULT_PROCESS_EVENT_LIMIT = 500;
const MAX_PROCESS_EVENT_LIMIT = 1000;

interface ProcessEventProjection {
  event: SessionProcessEvent;
  endMs: number;
  order: number;
  startMs: number;
}

interface SessionProcessEventAccess {
  id: SessionId;
  updatedAt: string;
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
  const sortedProjections = projections.toSorted(
    (a, b) => a.startMs - b.startMs || a.order - b.order,
  );

  return sortedProjections.map((projection, index) => {
    const next = sortedProjections[index + 1] ?? null;
    const durationMs =
      projection.endMs > projection.startMs
        ? projection.endMs - projection.startMs
        : next === null
          ? 0
          : Math.max(0, next.startMs - projection.startMs);

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

function toProcessEventProjectionFromSessionEventRow(
  row: SessionEventProcessRow,
): ProcessEventProjection {
  return {
    endMs: row.ended_at,
    event: {
      content: row.content_text,
      durationMs: 0,
      id: row.id,
      occurredAt: toIsoString(row.occurred_at),
      status: row.process_status,
      tokens: row.tokens,
      type: row.process_type,
    },
    order: row.seq,
    startMs: row.occurred_at,
  };
}

export function createSessionProcessEventsFromSessionEventRows(
  rows: SessionEventProcessRow[],
  options: { foldStreamedRows?: boolean } = {},
): SessionProcessEvent[] {
  const foldedRows =
    options.foldStreamedRows === false
      ? rows
      : foldStreamedSessionEventRows(rows, { flushOpenStreams: true }).rows;
  const projections = foldedRows.map(toProcessEventProjectionFromSessionEventRow);

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
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionProcessEventAccess> {
  const row = await getAppSessionParticipantTimelineAccess(database, viewerId, input);

  return {
    id: row.id,
    updatedAt: toIsoString(row.updated_at),
  };
}

async function listSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    limit?: number | null;
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<SessionProcessEvent[]> {
  const limit = normalizeProcessEventLimit(input.limit);
  const session = await getThreadSessionProcessEventAccess(database, viewer.id, {
    appId: input.appId,
    sessionId: input.sessionId,
  });
  const rows = await getAppDatabase(database)
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
      tokens: sessionEventsTable.tokens,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.visibility, "all_consumers"),
      ),
    )
    .orderBy(desc(sessionEventsTable.seq))
    .limit(limit + 1)
    .all();

  if (rows.length === 0) {
    return [createNoRuntimeEventsRecordedEvent(session)];
  }

  const hasMore = rows.length > limit;
  const processEvents = createSessionProcessEventsFromSessionEventRows(
    rows.slice(0, limit).toReversed(),
  );

  if (!hasMore) {
    return processEvents;
  }

  const firstEvent = processEvents[0] ?? null;

  if (firstEvent === null) {
    return processEvents;
  }

  return [
    createProcessEventsTruncatedEvent({
      limit,
      occurredAt: firstEvent.occurredAt,
      sessionId: session.id,
    }),
    ...processEvents,
  ];
}

export async function getSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  session: {
    appId: AppId;
    sessionId: SessionId;
  },
  options: {
    limit?: number | null;
  } = {},
): Promise<SessionProcessEvent[]> {
  return listSessionProcessEvents(database, viewer, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    appId: session.appId,
    sessionId: session.sessionId,
  });
}

export async function getThreadSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  session: {
    appId: AppId;
    sessionId: SessionId;
  },
  options: {
    limit?: number | null;
  } = {},
): Promise<SessionProcessEvent[]> {
  return listSessionProcessEvents(database, viewer, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    appId: session.appId,
    sessionId: session.sessionId,
  });
}
