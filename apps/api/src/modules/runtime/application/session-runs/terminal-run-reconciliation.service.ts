import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  driverInstancesTable,
  sandboxBackupsTable,
  sessionEventsTable,
  sessionModelCallsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, exists, inArray, isNotNull, isNull, not, or } from "drizzle-orm";

import { logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { finalizeSessionModelCallUsage } from "../../../sessions/infrastructure/session-model-call.repository";
import { TERMINAL_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { getSessionRunCompletionProof } from "../../infrastructure/session-runs/session-run-completion-proof";
import {
  getSessionRunSummariesByIds,
  setSessionRunStatus,
} from "../../infrastructure/session-runs/session-run-store.repository";
import { sessionRunTerminalEventExists } from "../../infrastructure/session-runs/session-run-write.repository";
import {
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
  toTerminalRunEventKind,
} from "./session-run-view-events.service";

const TERMINAL_DRIVER_STATUSES = ["failed", "stopped"] as const;

class MissingCompletionProofError extends Error {
  constructor() {
    super(
      "Completed Run reconciliation requires its committed checkpoint, ready backup, and canonical receipt.",
    );
  }
}

interface TerminalRunCandidate {
  readonly runId: SessionRunId;
  readonly sessionId: SessionId;
  readonly sessionLastRunId: SessionRunId | null;
  readonly sessionStatus: SessionStatus;
  readonly terminalEventExists: number;
}

export interface TerminalRunReconciliationResult {
  readonly reconciledRunIds: readonly SessionRunId[];
  readonly reconciledSessionIds: readonly SessionId[];
}

interface RepairTerminalSessionRunProjectionsInput {
  readonly preserveSessionLifecycle: boolean;
  readonly run: SessionRunSummary;
  readonly sessionId: SessionId;
  readonly terminalEventExists?: boolean;
}

function createTerminalRunRecoveryEvent(input: {
  readonly kind: "run.cancelled" | "run.failed";
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
  const unfinishedUsage = exists(
    database
      .select({ id: sessionModelCallsTable.id })
      .from(sessionModelCallsTable)
      .where(
        and(
          eq(sessionModelCallsTable.sessionRunId, sessionRunsTable.id),
          eq(sessionModelCallsTable.status, "started"),
        ),
      ),
  );
  const staleSessionProjection = and(
    eq(sessionsTable.lastRunId, sessionRunsTable.id),
    eq(sessionsTable.status, "RUNNING"),
  );
  const completionCanBeVerified = and(
    exists(
      database
        .select({ id: sessionEventsTable.id })
        .from(sessionEventsTable)
        .where(
          and(
            eq(sessionEventsTable.runId, sessionRunsTable.id),
            eq(sessionEventsTable.eventType, "run.completed"),
            isNotNull(sessionEventsTable.canonicalEventJson),
          ),
        ),
    ),
    exists(
      database
        .select({ id: sandboxBackupsTable.id })
        .from(sandboxBackupsTable)
        .where(
          and(
            eq(sandboxBackupsTable.sessionRunId, sessionRunsTable.id),
            eq(sandboxBackupsTable.status, "ready"),
          ),
        ),
    ),
  );

  return database
    .select({
      runId: sessionRunsTable.id,
      sessionId: sessionRunsTable.sessionId,
      sessionLastRunId: sessionsTable.lastRunId,
      sessionStatus: sessionsTable.status,
      terminalEventExists: sessionRunTerminalEventExists(),
    })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .leftJoin(driverInstancesTable, eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId))
    .where(
      and(
        inArray(sessionRunsTable.status, TERMINAL_SESSION_RUN_STATUSES),
        or(not(eq(sessionRunsTable.status, "completed")), completionCanBeVerified),
        isNull(sessionsTable.archivedAt),
        inArray(sessionsTable.status, ["IDLE", "RESCHEDULING", "RUNNING"]),
        or(
          isNull(sessionRunsTable.driverInstanceId),
          isNull(driverInstancesTable.id),
          inArray(driverInstancesTable.status, TERMINAL_DRIVER_STATUSES),
        ),
        or(staleSessionProjection, not(sessionRunTerminalEventExists()), unfinishedUsage),
      ),
    )
    .orderBy(asc(sessionRunsTable.updatedAt), asc(sessionRunsTable.id))
    .limit(limit)
    .all();
}

export async function repairTerminalSessionRunProjections(
  bindings: ApiBindings,
  input: RepairTerminalSessionRunProjectionsInput,
): Promise<boolean> {
  const kind = toTerminalRunEventKind(input.run.status);
  if (
    kind === "run.completed" &&
    (await getSessionRunCompletionProof(bindings.DB, {
      runId: input.run.id,
      sessionId: input.sessionId,
    })) === null
  ) {
    throw new MissingCompletionProofError();
  }

  const projection = await setSessionRunStatus(bindings.DB, {
    preserveSessionLifecycle: input.preserveSessionLifecycle,
    runId: input.run.id,
    source: "maintenance",
    status: input.run.status,
  });
  if (projection.kind !== "applied" && projection.kind !== "duplicate") {
    throw new Error("Terminal run reconciliation lost a concurrent run transition.");
  }
  const usageFinalized = await finalizeSessionModelCallUsage(bindings.DB, input.run.id);
  if (kind === "run.completed") return usageFinalized;

  const terminalEventExists =
    input.terminalEventExists ??
    Boolean(
      await getAppDatabase(bindings.DB)
        .select({ id: sessionEventsTable.id })
        .from(sessionEventsTable)
        .where(
          and(eq(sessionEventsTable.runId, input.run.id), eq(sessionEventsTable.eventType, kind)),
        )
        .limit(1)
        .get(),
    );
  if (terminalEventExists) return usageFinalized;

  const persisted = await appendSessionRuntimeEvents({
    bindings,
    events: [
      createTerminalRunRecoveryEvent({
        kind,
        run: input.run,
        sessionId: input.sessionId,
        sourceEventId: createSessionRunTerminalSourceId(input.run.id, kind),
      }),
    ],
    sessionId: input.sessionId,
  });
  return usageFinalized || persisted.persistedCount > 0;
}

/**
 * Success requires the original atomic checkpoint receipt; only failure and
 * cancellation events can be reconstructed from a terminal Run row alone.
 */
export async function reconcileTerminalSessionRuns(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
  },
): Promise<TerminalRunReconciliationResult> {
  const candidates = await findTerminalRunCandidates(bindings, input.limit);
  const runsById = await getSessionRunSummariesByIds(
    bindings.DB,
    candidates.map((candidate) => candidate.runId),
  );
  const reconciledRunIds: SessionRunId[] = [];
  const reconciledSessionIds = new Set<SessionId>();

  for (const candidate of candidates) {
    const run = runsById.get(candidate.runId);

    if (run === undefined) {
      continue;
    }

    let repaired: boolean;
    try {
      repaired = await repairTerminalSessionRunProjections(bindings, {
        preserveSessionLifecycle:
          candidate.sessionLastRunId !== run.id || candidate.sessionStatus !== "RUNNING",
        run,
        sessionId: candidate.sessionId,
        terminalEventExists: candidate.terminalEventExists === 1,
      });
    } catch (error) {
      if (!(error instanceof MissingCompletionProofError)) throw error;
      logWarn("session.run.completion_repair_skipped", {
        errorMessage: error.message,
        runId: run.id,
        sessionId: candidate.sessionId,
      });
      continue;
    }
    if (repaired) reconciledRunIds.push(run.id);

    reconciledSessionIds.add(candidate.sessionId);
  }

  return {
    reconciledRunIds,
    reconciledSessionIds: [...reconciledSessionIds],
  };
}
