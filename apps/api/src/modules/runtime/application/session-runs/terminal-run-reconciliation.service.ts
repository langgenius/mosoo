import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  driverInstancesTable,
  sessionEventsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import {
  getSessionRunSummariesByIds,
  setSessionRunStatus,
} from "../../infrastructure/session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../../infrastructure/session-runs/session-run-store.repository";
import {
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
} from "./session-run-view-events.service";

const TERMINAL_RUN_STATUSES = ["cancelled", "completed", "expired", "failed"] as const;
const TERMINAL_DRIVER_STATUSES = ["failed", "stopped"] as const;

interface TerminalRunCandidate {
  readonly runId: SessionRunId;
  readonly sessionId: SessionId;
  readonly sessionLastRunId: SessionRunId | null;
  readonly sessionStatus: SessionStatus;
}

export interface TerminalRunReconciliationResult {
  readonly reconciledRunIds: readonly SessionRunId[];
  readonly reconciledSessionIds: readonly SessionId[];
}

function assertTerminalRunProjection(outcome: SessionRunTransitionOutcome): void {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return;
    }
    case "repair_needed": {
      throw new Error("Terminal run reconciliation left the session lifecycle projection stale.");
    }
    case "rejected":
    case "stale": {
      throw new Error("Terminal run reconciliation lost a concurrent run transition.");
    }
  }
}

function terminalEventKind(
  status: SessionRunStatus,
): "run.cancelled" | "run.completed" | "run.failed" {
  switch (status) {
    case "completed": {
      return "run.completed";
    }
    case "failed": {
      return "run.failed";
    }
    case "cancelled":
    case "expired": {
      return "run.cancelled";
    }
    case "queued":
    case "booting":
    case "running":
    case "waiting_input": {
      throw new Error(`Expected terminal Session Run status, received ${status}.`);
    }
  }
}

function createTerminalRunRecoveryEvent(input: {
  readonly kind: "run.cancelled" | "run.completed" | "run.failed";
  readonly run: SessionRunSummary;
  readonly sessionId: SessionId;
  readonly sourceEventId: string;
}) {
  if (input.kind !== "run.failed") {
    return createSessionRunUpdatedEvent(input.run, input.sessionId, "IDLE", input.sourceEventId);
  }

  return createFailedSessionRunRuntimeEvent({
    run: input.run,
    runError: input.run.error ?? {
      code: "runtime.terminal_error_missing",
      details: {},
      message: "The run failed without a persisted error.",
      retryable: false,
    },
    sessionId: input.sessionId,
    sourceEventId: input.sourceEventId,
  });
}

async function findTerminalRunCandidates(
  bindings: ApiBindings,
  limit: number,
): Promise<TerminalRunCandidate[]> {
  const database = getAppDatabase(bindings.DB);
  const expectedEventType = sql<string>`
    CASE ${sessionRunsTable.status}
      WHEN 'completed' THEN 'run.completed'
      WHEN 'failed' THEN 'run.failed'
      ELSE 'run.cancelled'
    END
  `;
  const missingTerminalEvent = notExists(
    database
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, sessionRunsTable.sessionId),
          eq(sessionEventsTable.runId, sessionRunsTable.id),
          sql`${sessionEventsTable.eventType} = ${expectedEventType}`,
        ),
      ),
  );
  const staleSessionProjection = and(
    eq(sessionsTable.lastRunId, sessionRunsTable.id),
    eq(sessionsTable.status, "RUNNING"),
  );

  return database
    .select({
      runId: sessionRunsTable.id,
      sessionId: sessionRunsTable.sessionId,
      sessionLastRunId: sessionsTable.lastRunId,
      sessionStatus: sessionsTable.status,
    })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .leftJoin(driverInstancesTable, eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId))
    .where(
      and(
        inArray(sessionRunsTable.status, TERMINAL_RUN_STATUSES),
        isNull(sessionsTable.archivedAt),
        inArray(sessionsTable.status, ["IDLE", "RESCHEDULING", "RUNNING"]),
        or(
          isNull(sessionRunsTable.driverInstanceId),
          isNull(driverInstancesTable.id),
          inArray(driverInstancesTable.status, TERMINAL_DRIVER_STATUSES),
        ),
        or(staleSessionProjection, missingTerminalEvent),
      ),
    )
    .orderBy(asc(sessionRunsTable.updatedAt), asc(sessionRunsTable.id))
    .limit(limit)
    .all();
}

async function readPersistedTerminalEventKeys(
  bindings: ApiBindings,
  runIds: readonly SessionRunId[],
): Promise<Set<string>> {
  if (runIds.length === 0) {
    return new Set<string>();
  }

  const rows = await getAppDatabase(bindings.DB)
    .select({
      eventType: sessionEventsTable.eventType,
      runId: sessionEventsTable.runId,
    })
    .from(sessionEventsTable)
    .where(
      and(
        inArray(sessionEventsTable.runId, [...runIds]),
        inArray(sessionEventsTable.eventType, ["run.cancelled", "run.completed", "run.failed"]),
      ),
    )
    .all();

  return new Set(
    rows.flatMap((row) => (row.runId === null ? [] : [`${row.runId}:${row.eventType}`])),
  );
}

/**
 * Repairs terminal Run projections after the Driver can no longer replay its
 * final event. The terminal Run row itself is the durable, idempotent repair
 * obligation: a missing matching terminal session_event is reconstructed with
 * a stable source id, while a duplicate status transition repairs the owning
 * Session lifecycle projection.
 */
export async function reconcileTerminalSessionRuns(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
  },
): Promise<TerminalRunReconciliationResult> {
  const candidates = await findTerminalRunCandidates(bindings, input.limit);
  const runIds = candidates.map((candidate) => candidate.runId);
  const [runsById, persistedTerminalEventKeys] = await Promise.all([
    getSessionRunSummariesByIds(bindings.DB, runIds),
    readPersistedTerminalEventKeys(bindings, runIds),
  ]);
  const reconciledRunIds: SessionRunId[] = [];
  const reconciledSessionIds = new Set<SessionId>();

  for (const candidate of candidates) {
    const run = runsById.get(candidate.runId);

    if (run === undefined) {
      continue;
    }

    if (candidate.sessionLastRunId === run.id && candidate.sessionStatus === "RUNNING") {
      const projection = await setSessionRunStatus(bindings.DB, {
        runId: run.id,
        source: "maintenance",
        status: run.status,
      });
      assertTerminalRunProjection(projection);
    }

    const kind = terminalEventKind(run.status);
    const eventKey = `${run.id}:${kind}`;

    if (!persistedTerminalEventKeys.has(eventKey)) {
      const sourceEventId = createSessionRunTerminalSourceId(run.id, kind);
      const persisted = await appendSessionRuntimeEvents({
        bindings,
        events: [
          createTerminalRunRecoveryEvent({
            kind,
            run,
            sessionId: candidate.sessionId,
            sourceEventId,
          }),
        ],
        sessionId: candidate.sessionId,
      });

      if (persisted.persistedCount > 0) {
        reconciledRunIds.push(run.id);
      }
    }

    reconciledSessionIds.add(candidate.sessionId);
  }

  return {
    reconciledRunIds,
    reconciledSessionIds: [...reconciledSessionIds],
  };
}
