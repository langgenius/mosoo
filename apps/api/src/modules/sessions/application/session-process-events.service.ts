import { createProcessEventsTruncatedEventId } from "@mosoo/contracts/session";
import type { SessionProcessEvent } from "@mosoo/contracts/session";
import type { ProjectId, SessionId, SessionRunId } from "@mosoo/id";

import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { requireProjectSession } from "../domain/session-access.policy";
import {
  readFoldedSessionEventRows,
  readSessionEventWindow,
} from "../infrastructure/session-event-read.repository";
import type { SessionEventProcessRow } from "../infrastructure/session-event-read.repository";

const DEFAULT_PROCESS_EVENT_LIMIT = 500;
const MAX_PROCESS_EVENT_LIMIT = 1000;
// Longer gaps may be permission or user waits, not continuous execution.
const MAX_INFERRED_PROCESS_EVENT_DURATION_MS = 5 * 60 * 1000;

interface ProcessEventProjection {
  event: SessionProcessEvent;
  endMs: number;
  order: number;
  runId: SessionRunId | null;
  startMs: number;
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
    runId: row.run_id,
    startMs: row.occurred_at,
  };
}

export function createSessionProcessEventsFromFoldedRows(
  rows: SessionEventProcessRow[],
): SessionProcessEvent[] {
  const projections = rows.map(toProcessEventProjectionFromSessionEventRow);
  const latestUsage = new Map<SessionRunId, Map<string, ProcessEventProjection>>();
  for (const [index, row] of rows.entries()) {
    if (row.run_id === null || row.usage_key == null || row.tokens === null) continue;
    let calls = latestUsage.get(row.run_id);
    if (calls === undefined) {
      calls = new Map();
      latestUsage.set(row.run_id, calls);
    }
    // Usage snapshots replace the same Run/call in the model-call ledger.
    // Keep their history, but count only the latest snapshot in replay totals.
    const previous = calls.get(row.usage_key);
    if (previous !== undefined) previous.event.tokens = null;
    calls.set(row.usage_key, projections[index]!);
  }
  return finalizeProcessEventDurations(projections);
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

export async function getThreadSessionProcessEvents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
  options: {
    limit?: number | null;
  } = {},
): Promise<SessionProcessEvent[]> {
  const limit = normalizeProcessEventLimit(options.limit);
  const session = await requireProjectSession(database, viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  const window = await readSessionEventWindow(database, {
    rowLimit: limit,
    sessionId: input.sessionId,
  });
  const rows = await readFoldedSessionEventRows(database, { sessionId: input.sessionId, window });
  const processEvents = createSessionProcessEventsFromFoldedRows(rows);

  if (!window.truncated) {
    return processEvents;
  }

  const firstOccurredAt = processEvents[0]?.occurredAt ?? toIsoString(window.oldestOccurredAt ?? 0);

  return [
    createProcessEventsTruncatedEvent({
      limit,
      occurredAt: firstOccurredAt,
      sessionId: session.id,
    }),
    ...processEvents,
  ];
}
