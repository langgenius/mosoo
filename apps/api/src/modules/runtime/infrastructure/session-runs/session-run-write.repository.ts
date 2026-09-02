import type { SessionStatus } from "@mosoo/contracts/session";
import type {
  SessionRunStatus,
  SessionRunSummary,
  SessionRunTrigger,
} from "@mosoo/contracts/session-run";
import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { generateTraceId } from "@mosoo/observability";
import { and, eq, exists, isNull, notInArray, sql } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import {
  decideSessionRunTransition,
  isTerminalSessionRunStatus,
  toSessionRunStatusLifecycleEventName,
} from "../../domain/session-run-lifecycle.machine";
import { createSessionStatusTransitionPatch } from "./session-lifecycle-projection.repository";
import { getActiveSessionRunSummary } from "./session-run-read.repository";
import { buildActiveSessionRunStatusFilter, toSessionRunSummary } from "./session-run-row.mapper";
import type { ActiveSessionRunStatus } from "./session-run-row.mapper";
import { updateSessionLastRun } from "./session-run-session.repository";

type SessionRunStatusUpdateInput = {
  source?: SessionRunTransitionSource;
  status: ActiveSessionRunStatus;
};

type UpdateSessionRunStatusInput = SessionRunStatusUpdateInput & {
  /**
   * Reject the transition unless the run is currently in this status. The
   * check is atomic with the write via the status_seq optimistic guard.
   */
  expectedCurrentStatus?: SessionRunStatus;
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

interface LoadedSessionRunLifecycleRow {
  completed_at: number | null;
  created_at: number;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  error_code: string | null;
  error_details_json: string | null;
  error_message: string | null;
  error_retryable: boolean | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  runtime_id: string;
  session_archived_at: number | null;
  session_cleanup_operation_kind: "archive" | "delete" | null;
  session_id: SessionId;
  session_last_run_id: SessionRunId | null;
  session_status: SessionStatus;
  session_status_operation_id: RuntimeOperationId | null;
  session_status_seq: number;
  session_updated_at: number;
  started_at: number | null;
  status: SessionRunStatus;
  status_seq: number;
  trace_id: string;
  trigger: SessionRunTrigger;
  updated_at: number;
}

export type SessionRunTransitionOutcome =
  | {
      kind: "applied";
      previousStatus: SessionRunStatus;
      run: SessionRunSummary;
      sessionLifecycle: "current_last_run_updated" | "not_current_last_run";
      statusSeq: number;
    }
  | {
      currentStatus: SessionRunStatus;
      kind: "duplicate";
      run: SessionRunSummary;
      statusSeq: number;
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
    }
  | {
      kind: "repair_needed";
      previousStatus: SessionRunStatus;
      reason: "session_lifecycle_not_updated";
      run: SessionRunSummary;
      statusSeq: number;
    };

function createSessionRunStatusUpdate(input: SessionRunStatusUpdateInput, timestampMs: number) {
  return {
    completedAt: undefined,
    errorCode: null,
    errorDetailsJson: null,
    errorMessage: null,
    errorRetryable: null,
    startedAt:
      input.status === "queued"
        ? undefined
        : sql`COALESCE(${sessionRunsTable.startedAt}, ${timestampMs})`,
    status: input.status,
    statusChangedAt: timestampMs,
    statusEvent: toSessionRunStatusLifecycleEventName(input.status),
    statusOperationId: null,
    statusSeq: sql`${sessionRunsTable.statusSeq} + 1`,
    statusSource: input.source ?? "system",
    updatedAt: timestampMs,
  };
}

function createCurrentSessionRunProjectionPatch(input: {
  readonly status: ActiveSessionRunStatus;
  readonly timestampMs: number;
}) {
  return createSessionStatusTransitionPatch({
    status: toSessionLifecycleStatusForRunStatus(input.status),
    timestampMs: input.timestampMs,
  });
}

function applySessionRunStatusUpdate(
  run: SessionRunSummary,
  input: SessionRunStatusUpdateInput,
  timestampMs: number,
): SessionRunSummary {
  return {
    ...run,
    completedAt: run.completedAt,
    error: null,
    startedAt:
      input.status === "queued" ? run.startedAt : (run.startedAt ?? toIsoString(timestampMs)),
    status: input.status,
    updatedAt: toIsoString(timestampMs),
  };
}

function sessionRunLifecycleColumns() {
  return {
    completed_at: sessionRunsTable.completedAt,
    created_at: sessionRunsTable.createdAt,
    deployment_version_id: sessionRunsTable.deploymentVersionId,
    deployment_version_number: sessionRunsTable.deploymentVersionNumber,
    error_code: sessionRunsTable.errorCode,
    error_details_json: sessionRunsTable.errorDetailsJson,
    error_message: sessionRunsTable.errorMessage,
    error_retryable: sessionRunsTable.errorRetryable,
    id: sessionRunsTable.id,
    model: sessionRunsTable.model,
    provider: sessionRunsTable.provider,
    runtime_id: sessionsTable.runtimeId,
    session_archived_at: sessionsTable.archivedAt,
    session_cleanup_operation_kind: sessionsTable.cleanupOperationKind,
    session_id: sessionRunsTable.sessionId,
    session_last_run_id: sessionsTable.lastRunId,
    session_status: sessionsTable.status,
    session_status_operation_id: sessionsTable.statusOperationId,
    session_status_seq: sessionsTable.statusSeq,
    session_updated_at: sessionsTable.updatedAt,
    started_at: sessionRunsTable.startedAt,
    status: sessionRunsTable.status,
    status_seq: sessionRunsTable.statusSeq,
    trace_id: sessionRunsTable.traceId,
    trigger: sessionRunsTable.trigger,
    updated_at: sessionRunsTable.updatedAt,
  };
}

function writableObservedSessionCondition(current: LoadedSessionRunLifecycleRow) {
  return and(
    eq(sessionsTable.id, current.session_id),
    current.session_last_run_id === null
      ? isNull(sessionsTable.lastRunId)
      : eq(sessionsTable.lastRunId, current.session_last_run_id),
    eq(sessionsTable.status, current.session_status),
    notInArray(sessionsTable.status, ["TERMINATED"]),
    eq(sessionsTable.statusSeq, current.session_status_seq),
    eq(sessionsTable.updatedAt, current.session_updated_at),
    isNull(sessionsTable.archivedAt),
    isNull(sessionsTable.cleanupOperationKind),
    isNull(sessionsTable.statusOperationId),
  );
}

function toSessionRunSummaryFromLifecycleRow(row: LoadedSessionRunLifecycleRow): SessionRunSummary {
  return toSessionRunSummary({
    completed_at: row.completed_at,
    created_at: row.created_at,
    deployment_version_id: row.deployment_version_id,
    deployment_version_number: row.deployment_version_number,
    error_code: row.error_code,
    error_details_json: row.error_details_json,
    error_message: row.error_message,
    error_retryable: row.error_retryable,
    id: row.id,
    model: row.model,
    provider: row.provider,
    session_id: row.session_id,
    started_at: row.started_at,
    status: row.status,
    trace_id: row.trace_id,
    trigger: row.trigger,
    updated_at: row.updated_at,
  });
}

function toUpdatedSessionRunSummary(
  row: LoadedSessionRunLifecycleRow,
  input: SessionRunStatusUpdateInput,
  timestampMs: number,
): SessionRunSummary {
  return applySessionRunStatusUpdate(toSessionRunSummaryFromLifecycleRow(row), input, timestampMs);
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
    error_retryable: null,
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

export async function createSessionRunRecordIfSessionIdle(
  database: D1Database,
  input: {
    agentId: AgentId;
    createdBy: AccountId;
    deploymentVersionId?: AgentDeploymentVersionId | null;
    deploymentVersionNumber?: number | null;
    model?: string | null;
    provider?: string | null;
    runtimeId?: string | null;
    sessionId: SessionId;
    startedAt?: number | null;
    status: ActiveSessionRunStatus;
    traceId?: string;
    trigger: SessionRunTrigger;
  },
): Promise<
  | {
      activeRun: null;
      createdRun: SessionRunSummary;
    }
  | {
      activeRun: SessionRunSummary;
      createdRun: null;
    }
> {
  const timestampMs = currentTimestampMs();
  const runId = createPlatformId<SessionRunId>();
  const traceId = input.traceId ?? generateTraceId();

  const inserted =
    (await getAppDatabase(database).get<{ id: SessionRunId }>(
      sql`
          INSERT INTO session_run
            (
              id,
              session_id,
              trigger,
              status,
              agent_id,
              deployment_version_id,
              deployment_version_number,
              runtime_id,
              provider,
              model,
              trace_id,
              error_code,
              error_message,
              error_details_json,
              error_retryable,
              started_at,
              completed_at,
              created_by_account_id,
              created_at,
              status_changed_at,
              status_event,
              status_operation_id,
              status_seq,
              status_source,
              updated_at
            )
          SELECT
            ${runId},
            ${input.sessionId},
            ${input.trigger},
            ${input.status},
            ${input.agentId},
            ${input.deploymentVersionId ?? null},
            ${input.deploymentVersionNumber ?? null},
            ${input.runtimeId ?? null},
            ${input.provider ?? null},
            ${input.model ?? null},
            ${traceId},
            NULL,
            NULL,
            NULL,
            NULL,
            ${input.startedAt ?? null},
            NULL,
            ${input.createdBy},
            ${timestampMs},
            ${timestampMs},
            ${toSessionRunStatusLifecycleEventName(input.status)},
            NULL,
            0,
            'api',
            ${timestampMs}
          FROM session
          WHERE id = ${input.sessionId}
            AND archived_at IS NULL
            AND status = 'IDLE'
            AND status_operation_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM session_run
              WHERE session_id = ${input.sessionId}
                AND ${sql.raw(buildActiveSessionRunStatusFilter())}
            )
          RETURNING id
        `,
    )) ?? null;

  if (!inserted) {
    const activeRun = await getActiveSessionRunSummary(database, input.sessionId);

    if (!activeRun) {
      throw new Error("Session cannot accept a new run.");
    }

    return {
      activeRun,
      createdRun: null,
    };
  }

  const sessionUpdated = await updateSessionLastRun(database, {
    model: input.model ?? null,
    provider: input.provider ?? null,
    runId,
    sessionId: input.sessionId,
    timestampMs,
  });

  if (!sessionUpdated) {
    await getAppDatabase(database)
      .delete(sessionRunsTable)
      .where(eq(sessionRunsTable.id, runId))
      .run();
    throw new Error("Session cannot accept a new run.");
  }

  return {
    activeRun: null,
    createdRun: createInsertedSessionRunSummary(input, {
      runId,
      timestampMs,
      traceId,
    }),
  };
}

export async function setSessionRunStatus(
  database: D1Database,
  input: UpdateSessionRunStatusInput,
): Promise<SessionRunTransitionOutcome> {
  if (isTerminalSessionRunStatus(input.status)) {
    throw new Error("Terminal Session Run transitions require the atomic terminal projection.");
  }
  return transitionSessionRunStatusAt(database, input, currentTimestampMs());
}

async function transitionSessionRunStatusAt(
  database: D1Database,
  input: UpdateSessionRunStatusInput,
  timestampMs: number,
): Promise<SessionRunTransitionOutcome> {
  return transitionSessionRunStatus(database, input, timestampMs);
}

async function repairCurrentSessionRunProjection(
  database: D1Database,
  input: {
    readonly current: LoadedSessionRunLifecycleRow;
    readonly timestampMs: number;
    readonly targetStatus: SessionRunStatus;
  },
): Promise<"not_current_last_run" | "repaired" | "already_projected" | "repair_needed"> {
  if (input.current.session_last_run_id !== input.current.id) {
    return "not_current_last_run";
  }

  const projectedStatus = toSessionLifecycleStatusForRunStatus(input.targetStatus);

  if (
    input.current.session_status === projectedStatus &&
    input.current.session_archived_at === null &&
    input.current.session_cleanup_operation_kind === null &&
    input.current.session_status_operation_id === null
  ) {
    return "already_projected";
  }

  if (
    input.current.session_archived_at !== null ||
    input.current.session_cleanup_operation_kind !== null ||
    input.current.session_status_operation_id !== null ||
    input.current.session_status === "TERMINATED"
  ) {
    return "repair_needed";
  }

  const sessionUpdateResult = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: projectedStatus,
        timestampMs: input.timestampMs,
      }),
    )
    .where(writableObservedSessionCondition(input.current))
    .run();

  return getD1ChangeCount(sessionUpdateResult) > 0 ? "repaired" : "repair_needed";
}

async function transitionSessionRunStatus(
  database: D1Database,
  input: UpdateSessionRunStatusInput,
  timestampMs: number,
): Promise<SessionRunTransitionOutcome> {
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
      const projection = await repairCurrentSessionRunProjection(database, {
        current,
        targetStatus: input.status,
        timestampMs,
      });

      if (projection === "repair_needed") {
        return {
          kind: "repair_needed",
          previousStatus: current.status,
          reason: "session_lifecycle_not_updated",
          run: toSessionRunSummaryFromLifecycleRow(current),
          statusSeq: current.status_seq,
        };
      }

      return {
        currentStatus: decision.currentStatus,
        kind: "duplicate",
        run: toSessionRunSummaryFromLifecycleRow(current),
        statusSeq: current.status_seq,
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

  const run = toUpdatedSessionRunSummary(current, input, timestampMs);
  const statusSeq = current.status_seq + 1;

  if (current.session_last_run_id !== input.runId) {
    const runUpdateResult = await getAppDatabase(database)
      .update(sessionRunsTable)
      .set(createSessionRunStatusUpdate(input, timestampMs))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.status, current.status),
          eq(sessionRunsTable.statusSeq, current.status_seq),
          exists(
            getAppDatabase(database)
              .select({ id: sessionsTable.id })
              .from(sessionsTable)
              .where(writableObservedSessionCondition(current)),
          ),
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

    return {
      kind: "applied",
      previousStatus: current.status,
      run,
      sessionLifecycle: "not_current_last_run",
      statusSeq,
    };
  }

  const [runUpdateResult, sessionUpdateResult] = await runAppDatabaseBatch(database, (db) => [
    db
      .update(sessionRunsTable)
      .set(createSessionRunStatusUpdate(input, timestampMs))
      .where(
        and(
          eq(sessionRunsTable.id, input.runId),
          eq(sessionRunsTable.status, current.status),
          eq(sessionRunsTable.statusSeq, current.status_seq),
          exists(
            db
              .select({ id: sessionsTable.id })
              .from(sessionsTable)
              .where(writableObservedSessionCondition(current)),
          ),
        ),
      ),
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
          writableObservedSessionCondition(current),
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

  if (getD1ChangeCount(runUpdateResult) === 0) {
    return {
      currentStatus: current.status,
      kind: "stale",
      reason: "concurrent_transition",
      targetStatus: input.status,
    };
  }

  if (getD1ChangeCount(sessionUpdateResult) === 0 && current.session_status !== "TERMINATED") {
    return {
      kind: "repair_needed",
      previousStatus: current.status,
      reason: "session_lifecycle_not_updated",
      run,
      statusSeq,
    };
  }

  return {
    kind: "applied",
    previousStatus: current.status,
    run,
    sessionLifecycle: "current_last_run_updated",
    statusSeq,
  };
}
