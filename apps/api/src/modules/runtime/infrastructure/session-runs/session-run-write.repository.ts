import type { SessionStatus, SessionType } from "@mosoo/contracts/session";
import type {
  RunError,
  SessionRunStatus,
  SessionRunSummary,
  SessionRunTrigger,
} from "@mosoo/contracts/session-run";
import { sessionEventsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import type {
  AgentDeploymentVersionId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createConsoleLogger } from "@mosoo/observability";
import { and, eq, exists, inArray, notInArray, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import {
  ACTIVE_SESSION_RUN_STATUSES,
  decideSessionRunTransition,
  isTerminalSessionRunStatus,
  toSessionRunStatusLifecycleEventName,
} from "../../domain/session-run-lifecycle.machine";
import { createSessionStatusTransitionPatch } from "./session-lifecycle-projection.repository";
import {
  completionCheckpointRecordedCondition,
  completionCheckpointSnapshotCondition,
  completionCheckpointWrites,
} from "./session-run-completion-checkpoint";
import type { SessionRunCompletionCheckpoint } from "./session-run-completion-checkpoint";
import { sessionRunSummaryColumns } from "./session-run-read.repository";
import { toSessionRunSummary } from "./session-run-row.mapper";
import type { SessionRunRow } from "./session-run-row.mapper";

type SessionRunStatusUpdateInput = {
  error?: RunError | null;
  operationId?: RuntimeOperationId | null;
  source?: SessionRunTransitionSource;
  status: SessionRunStatus;
};

type UpdateSessionRunStatusInput = SessionRunStatusUpdateInput & {
  completionCheckpoint?: SessionRunCompletionCheckpoint;
  /**
   * Reject the transition unless the run is currently in this status. The
   * check is atomic with the write via the status_seq optimistic guard.
   */
  expectedCurrentStatus?: SessionRunStatus;
  preserveSessionLifecycle?: boolean;
  runId: SessionRunId;
};

export type CreateSessionRunSummaryInput = {
  deploymentVersionId?: AgentDeploymentVersionId | null;
  deploymentVersionNumber?: number | null;
  model?: string | null;
  provider?: string | null;
  sessionId: SessionId;
  startedAt?: number | null;
  status: SessionRunStatus;
  trigger: SessionRunTrigger;
};

type SessionRunTransitionSource =
  | "api"
  | "driver"
  | "maintenance"
  | "runtime_operation"
  | "system"
  | "viewer";

const terminalRunLogger = createConsoleLogger({ namespace: "api", service: "api" });
const terminalRunTransports = [...terminalRunLogger.getTransports()];
terminalRunLogger.removeTransport("console");
terminalRunLogger.addTransport({
  config: { level: "info", name: "terminal-event-time" },
  name: "terminal-event-time",
  log(entry) {
    // Keep the normal logger's sanitization, but retain the business event time
    // when a later invocation repairs a lost terminal observation.
    const completedAt = entry.metadata?.["completedAt"];
    for (const transport of terminalRunTransports) {
      void transport.log({
        ...entry,
        timestamp: typeof completedAt === "string" ? completedAt : entry.timestamp,
      });
    }
  },
});

interface LoadedSessionRunLifecycleRow extends SessionRunRow {
  runtime_id: string;
  session_last_run_id: SessionRunId | null;
  session_status: SessionStatus;
  session_type: SessionType;
  status_seq: number;
  status_source: string;
  terminal_event_exists: number;
}

export type SessionRunTransitionOutcome =
  | {
      kind: "applied";
      run: SessionRunSummary;
    }
  | {
      currentStatus: SessionRunStatus;
      kind: "duplicate";
      run: SessionRunSummary;
    }
  | {
      currentStatus: SessionRunStatus;
      kind: "rejected";
      reason: "illegal_transition" | "unexpected_current_status";
      targetStatus: SessionRunStatus;
    }
  | {
      kind: "rejected";
      reason: "not_found";
      targetStatus: SessionRunStatus;
    }
  | {
      currentStatus: SessionRunStatus;
      kind: "stale";
      reason: "concurrent_transition" | "terminal_run";
      targetStatus: SessionRunStatus;
    };

export function isStaleTerminalRunTransition(
  outcome: SessionRunTransitionOutcome | null,
  currentStatus?: SessionRunStatus,
): boolean {
  return (
    outcome?.kind === "stale" &&
    outcome.reason === "terminal_run" &&
    (currentStatus === undefined || outcome.currentStatus === currentStatus)
  );
}

/** Accepts applied and duplicate transitions, and a Run that was already terminal. */
export function assertSessionRunTransition(
  outcome: SessionRunTransitionOutcome,
  label: string,
): void {
  if (
    outcome.kind === "applied" ||
    outcome.kind === "duplicate" ||
    isStaleTerminalRunTransition(outcome)
  ) {
    return;
  }

  throw new Error(
    outcome.kind === "stale"
      ? `${label} lost a concurrent run transition.`
      : `${label} run transition was rejected: ${outcome.reason}.`,
  );
}

export interface NonTerminalSessionRunsStatusUpdateResult {
  readonly runIds: readonly SessionRunId[];
  readonly timestampMs: number;
}

function createSessionRunStatusUpdate(input: SessionRunStatusUpdateInput, timestampMs: number) {
  return {
    completedAt: isTerminalSessionRunStatus(input.status) ? timestampMs : undefined,
    errorCode: input.error?.code ?? null,
    errorDetailsJson: input.error ? JSON.stringify(input.error.details) : null,
    errorMessage: input.error?.message ?? null,
    startedAt:
      input.status === "queued"
        ? undefined
        : sql`COALESCE(${sessionRunsTable.startedAt}, ${timestampMs})`,
    status: input.status,
    statusChangedAt: timestampMs,
    statusEvent: toSessionRunStatusLifecycleEventName(input.status),
    statusOperationId: input.operationId ?? null,
    statusSeq: sql`${sessionRunsTable.statusSeq} + 1`,
    statusSource: input.source ?? "system",
    updatedAt: timestampMs,
  };
}

function createCurrentSessionRunProjectionPatch(input: {
  readonly status: SessionRunStatus;
  readonly timestampMs: number;
}) {
  return {
    ...createSessionStatusTransitionPatch({
      status: toSessionLifecycleStatusForRunStatus(input.status),
      timestampMs: input.timestampMs,
    }),
    ...(input.status === "completed" ? { workspaceCheckpointRequired: true } : {}),
  };
}

function logTerminalSessionRun(
  current: LoadedSessionRunLifecycleRow,
  input: SessionRunStatusUpdateInput,
  timestampMs: number,
): void {
  if (!isTerminalSessionRunStatus(input.status)) return;

  try {
    terminalRunLogger.info("session.run.terminal", {
      completedAt: toIsoString(timestampMs),
      // The committed transition initializes a missing started_at to this time.
      durationMs: Math.max(0, timestampMs - (current.started_at ?? timestampMs)),
      endToEndMs: Math.max(0, timestampMs - current.created_at),
      errorCode: input.error?.code ?? null,
      runId: current.id,
      runtimeId: current.runtime_id,
      sessionType: current.session_type,
      source: isTerminalSessionRunStatus(current.status)
        ? current.status_source
        : (input.source ?? "system"),
      status: input.status,
      traceId: current.trace_id,
      trigger: current.trigger,
    });
  } catch (error) {
    try {
      logWarn("session.run.terminal_log.failed", {
        ...createErrorLogContext(error),
        runId: current.id,
      });
    } catch {
      // Observability must never turn a committed Run transition into an API failure.
    }
  }
}

function applySessionRunStatusUpdate(
  run: SessionRunSummary,
  input: SessionRunStatusUpdateInput,
  timestampMs: number,
): SessionRunSummary {
  return {
    ...run,
    completedAt: isTerminalSessionRunStatus(input.status)
      ? toIsoString(timestampMs)
      : run.completedAt,
    error: input.error
      ? {
          code: input.error.code,
          details: input.error.details,
          message: input.error.message,
          retryable: input.error.retryable,
        }
      : null,
    startedAt:
      input.status === "queued" ? run.startedAt : (run.startedAt ?? toIsoString(timestampMs)),
    status: input.status,
    updatedAt: toIsoString(timestampMs),
  };
}

/** Whether the persisted session_event matching the Run's terminal status exists. */
export function sessionRunTerminalEventExists() {
  return sql<number>`EXISTS (
    SELECT 1 FROM ${sessionEventsTable}
    WHERE ${sessionEventsTable.runId} = ${sessionRunsTable.id}
      AND ${sessionEventsTable.eventType} = CASE ${sessionRunsTable.status}
        WHEN 'completed' THEN 'run.completed'
        WHEN 'failed' THEN 'run.failed'
        ELSE 'run.cancelled'
      END
  )`;
}

function sessionRunLifecycleColumns() {
  return {
    ...sessionRunSummaryColumns(),
    runtime_id: sql<string>`COALESCE(${sessionRunsTable.runtimeId}, ${sessionsTable.runtimeId})`,
    session_last_run_id: sessionsTable.lastRunId,
    session_status: sessionsTable.status,
    session_type: sessionsTable.type,
    status_seq: sessionRunsTable.statusSeq,
    status_source: sessionRunsTable.statusSource,
    terminal_event_exists: sessionRunTerminalEventExists(),
  };
}

export function createInsertedSessionRunSummary(
  input: CreateSessionRunSummaryInput,
  identifiers: {
    runId: SessionRunId;
    timestampMs: number;
    traceId: string;
  },
): SessionRunSummary {
  return toSessionRunSummary({
    completed_at: null,
    created_at: identifiers.timestampMs,
    deployment_version_id: input.deploymentVersionId ?? null,
    deployment_version_number: input.deploymentVersionNumber ?? null,
    error_code: null,
    error_details_json: null,
    error_message: null,
    id: identifiers.runId,
    model: input.model ?? null,
    provider: input.provider ?? null,
    session_id: input.sessionId,
    started_at: input.startedAt ?? null,
    status: input.status,
    trace_id: identifiers.traceId,
    trigger: input.trigger,
    updated_at: identifiers.timestampMs,
  });
}

export async function cancelActiveSessionRunsForRuntimeOperation(
  database: D1Database,
  input: {
    readonly error: RunError;
    readonly operationId: RuntimeOperationId;
    readonly runIds: readonly SessionRunId[];
  },
): Promise<NonTerminalSessionRunsStatusUpdateResult> {
  const timestampMs = currentTimestampMs();

  if (input.runIds.length === 0) {
    return {
      runIds: [],
      timestampMs,
    };
  }

  const db = getAppDatabase(database);
  await db
    .update(sessionRunsTable)
    .set(
      createSessionRunStatusUpdate(
        {
          error: input.error,
          operationId: input.operationId,
          source: "runtime_operation",
          status: "cancelled",
        },
        timestampMs,
      ),
    )
    .where(
      and(
        inArray(sessionRunsTable.id, input.runIds),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .run();
  // Re-read by operation so a replay after a crash still reports the Runs it cancelled.
  const rows = await db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        inArray(sessionRunsTable.id, input.runIds),
        eq(sessionRunsTable.status, "cancelled"),
        eq(sessionRunsTable.statusOperationId, input.operationId),
      ),
    )
    .all();

  return {
    runIds: rows.map((row) => row.id),
    timestampMs,
  };
}

async function repairCurrentSessionRunProjection(
  database: D1Database,
  input: {
    readonly current: LoadedSessionRunLifecycleRow;
    readonly timestampMs: number;
    readonly targetStatus: SessionRunStatus;
  },
): Promise<void> {
  const projectedStatus = toSessionLifecycleStatusForRunStatus(input.targetStatus);

  if (
    input.current.session_last_run_id !== input.current.id ||
    input.current.session_status === projectedStatus ||
    input.current.session_status === "TERMINATED"
  ) {
    return;
  }

  const sessionUpdateResult = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: projectedStatus,
        timestampMs: input.timestampMs,
      }),
    )
    .where(
      and(
        eq(sessionsTable.id, input.current.session_id),
        eq(sessionsTable.lastRunId, input.current.id),
        notInArray(sessionsTable.status, ["TERMINATED"]),
      ),
    )
    .run();

  if (getD1ChangeCount(sessionUpdateResult) === 0) {
    throw new Error("Session lifecycle projection needs repair.");
  }
}

export async function setSessionRunStatus(
  database: D1Database,
  input: UpdateSessionRunStatusInput,
): Promise<SessionRunTransitionOutcome> {
  const timestampMs = currentTimestampMs();
  const current =
    (await getAppDatabase(database)
      .select(sessionRunLifecycleColumns())
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .where(eq(sessionRunsTable.id, input.runId))
      .limit(1)
      .get()) ?? null;

  if (current === null) {
    return {
      kind: "rejected",
      reason: "not_found",
      targetStatus: input.status,
    };
  }

  if (input.expectedCurrentStatus !== undefined && current.status !== input.expectedCurrentStatus) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "unexpected_current_status",
      targetStatus: input.status,
    };
  }

  const decision = decideSessionRunTransition({
    currentStatus: current.status,
    targetStatus: input.status,
  });

  switch (decision.kind) {
    case "accepted": {
      break;
    }
    case "duplicate": {
      if (input.preserveSessionLifecycle !== true) {
        await repairCurrentSessionRunProjection(database, {
          current,
          targetStatus: input.status,
          timestampMs,
        });
      }

      const run = toSessionRunSummary(current);

      if (isTerminalSessionRunStatus(current.status) && !current.terminal_event_exists) {
        // A cancelled waitUntil can commit the Run but lose both its log and
        // event. Emit before persisting the event, which closes this repair
        // obligation. Tail consumers deduplicate these observations by runId.
        logTerminalSessionRun(
          current,
          {
            error: run.error,
            status: current.status,
          },
          current.completed_at ?? current.updated_at,
        );
      }

      return {
        currentStatus: decision.currentStatus,
        kind: "duplicate",
        run,
      };
    }
    case "rejected": {
      return {
        currentStatus: decision.currentStatus,
        kind: "rejected",
        reason: decision.reason,
        targetStatus: decision.targetStatus,
      };
    }
    case "stale": {
      return {
        currentStatus: decision.currentStatus,
        kind: "stale",
        reason: decision.reason,
        targetStatus: decision.targetStatus,
      };
    }
  }

  const run = applySessionRunStatusUpdate(toSessionRunSummary(current), input, timestampMs);
  const statusSeq = current.status_seq + 1;
  const checkpoint = input.completionCheckpoint;
  if (
    checkpoint !== undefined &&
    (input.status !== "completed" ||
      checkpoint.sessionRunId !== input.runId ||
      checkpoint.sessionId !== current.session_id ||
      current.session_last_run_id !== input.runId ||
      input.preserveSessionLifecycle === true)
  ) {
    throw new Error("A completion checkpoint must belong to the current Session Run.");
  }

  if (input.preserveSessionLifecycle === true || current.session_last_run_id !== input.runId) {
    const runUpdateResult = await getAppDatabase(database)
      .update(sessionRunsTable)
      .set(createSessionRunStatusUpdate(input, timestampMs))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.status, current.status),
          eq(sessionRunsTable.statusSeq, current.status_seq),
        ),
      )
      .run();

    if (getD1ChangeCount(runUpdateResult) === 0) {
      return {
        currentStatus: current.status,
        kind: "stale",
        reason: "concurrent_transition",
        targetStatus: input.status,
      };
    }

    logTerminalSessionRun(current, input, timestampMs);

    return { kind: "applied", run };
  }

  const results = await runAppDatabaseBatch(database, (db) => [
    db
      .update(sessionRunsTable)
      .set(createSessionRunStatusUpdate(input, timestampMs))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.status, current.status),
          eq(sessionRunsTable.statusSeq, current.status_seq),
          checkpoint === undefined
            ? undefined
            : completionCheckpointSnapshotCondition(db, checkpoint),
        ),
      ),
    ...(checkpoint === undefined ? [] : completionCheckpointWrites(db, checkpoint, timestampMs)),
    db
      .update(sessionsTable)
      .set(
        createCurrentSessionRunProjectionPatch({
          status: input.status,
          timestampMs,
        }),
      )
      .where(
        and(
          eq(sessionsTable.id, current.session_id),
          eq(sessionsTable.lastRunId, input.runId),
          notInArray(sessionsTable.status, ["TERMINATED"]),
          checkpoint === undefined
            ? undefined
            : completionCheckpointRecordedCondition(db, checkpoint),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(
                and(
                  eq(sessionRunsTable.id, input.runId),
                  eq(sessionRunsTable.status, input.status),
                  eq(sessionRunsTable.statusSeq, statusSeq),
                ),
              ),
          ),
        ),
      ),
  ]);

  const runUpdateResult = results[0];
  const sessionUpdateResult = results.at(-1);

  if (getD1ChangeCount(runUpdateResult) === 0) {
    return {
      currentStatus: current.status,
      kind: "stale",
      reason: "concurrent_transition",
      targetStatus: input.status,
    };
  }

  logTerminalSessionRun(current, input, timestampMs);

  if (getD1ChangeCount(sessionUpdateResult) === 0 && current.session_status !== "TERMINATED") {
    throw new Error("Session lifecycle projection needs repair.");
  }

  return { kind: "applied", run };
}
