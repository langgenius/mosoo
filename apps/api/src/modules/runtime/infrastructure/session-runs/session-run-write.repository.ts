import type { SessionStatus } from "@mosoo/contracts/session";
import type {
  RunError,
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
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import type { BoundCapabilityRunProvenance } from "../../domain/bound-capability-run-provenance";
import {
  ACTIVE_SESSION_RUN_STATUSES,
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
  error?: RunError | null;
  operationId?: RuntimeOperationId | null;
  source?: SessionRunTransitionSource;
  status: SessionRunStatus;
};

type UpdateSessionRunStatusInput = SessionRunStatusUpdateInput & {
  /**
   * Reject the transition unless the run is currently in this status. The
   * check is atomic with the write via the status_seq optimistic guard.
   */
  expectedCurrentStatus?: SessionRunStatus;
  preserveSessionLifecycle?: boolean;
  runId: SessionRunId;
};

type CreateSessionRunSummaryInput = {
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

const SESSION_RUN_STATUS_WRITE_BATCH_SIZE = 50;

/**
 * The caller supplied an atomic predicate for Run creation and it no longer
 * held when the INSERT statement executed. No Run record was created.
 */
export class SessionRunCreationGuardRejectedError extends Error {
  constructor() {
    super("Session Run creation authorization changed before the Run could be inserted.");
    this.name = "SessionRunCreationGuardRejectedError";
  }
}

interface LoadedSessionRunLifecycleRow {
  completed_at: number | null;
  created_at: number;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  error_code: string | null;
  error_details_json: string | null;
  error_message: string | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  session_id: SessionId;
  session_last_run_id: SessionRunId | null;
  session_status: SessionStatus;
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
      sessionLifecycle: "current_last_run_updated" | "not_current_last_run" | "preserved";
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

function sessionRunLifecycleColumns() {
  return {
    completed_at: sessionRunsTable.completedAt,
    created_at: sessionRunsTable.createdAt,
    deployment_version_id: sessionRunsTable.deploymentVersionId,
    deployment_version_number: sessionRunsTable.deploymentVersionNumber,
    error_code: sessionRunsTable.errorCode,
    error_details_json: sessionRunsTable.errorDetailsJson,
    error_message: sessionRunsTable.errorMessage,
    id: sessionRunsTable.id,
    model: sessionRunsTable.model,
    provider: sessionRunsTable.provider,
    session_id: sessionRunsTable.sessionId,
    session_last_run_id: sessionsTable.lastRunId,
    session_status: sessionsTable.status,
    started_at: sessionRunsTable.startedAt,
    status: sessionRunsTable.status,
    status_seq: sessionRunsTable.statusSeq,
    trace_id: sessionRunsTable.traceId,
    trigger: sessionRunsTable.trigger,
    updated_at: sessionRunsTable.updatedAt,
  };
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

function createInsertedSessionRunSummary(
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

export async function createSessionRunRecordIfSessionIdle(
  database: D1Database,
  input: {
    agentId: AgentId;
    boundCapabilityProvenance?: BoundCapabilityRunProvenance;
    createdBy: AccountId;
    deploymentVersionId?: AgentDeploymentVersionId | null;
    deploymentVersionNumber?: number | null;
    model?: string | null;
    provider?: string | null;
    runCreationGuard?: SQL;
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
              bound_capability_agent_id,
              bound_capability_app_id,
              bound_capability_binding_env,
              bound_capability_binding_name,
              bound_capability_deployment_id,
              bound_capability_deployment_run_id,
              deployment_version_id,
              deployment_version_number,
              runtime_id,
              provider,
              model,
              trace_id,
              error_code,
              error_message,
              error_details_json,
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
            ${input.boundCapabilityProvenance?.agentId ?? null},
            ${input.boundCapabilityProvenance?.appId ?? null},
            ${input.boundCapabilityProvenance?.bindingEnv ?? null},
            ${input.boundCapabilityProvenance?.bindingName ?? null},
            ${input.boundCapabilityProvenance?.deploymentId ?? null},
            ${input.boundCapabilityProvenance?.deploymentRunId ?? null},
            ${input.deploymentVersionId ?? null},
            ${input.deploymentVersionNumber ?? null},
            ${input.runtimeId ?? null},
            ${input.provider ?? null},
            ${input.model ?? null},
            ${traceId},
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
            AND ${input.runCreationGuard ?? sql`TRUE`}
          RETURNING id
        `,
    )) ?? null;

  if (!inserted) {
    const activeRun = await getActiveSessionRunSummary(database, input.sessionId);

    if (!activeRun) {
      if (input.runCreationGuard !== undefined) {
        throw new SessionRunCreationGuardRejectedError();
      }

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
  return transitionSessionRunStatusAt(database, input, currentTimestampMs());
}

export async function cancelActiveSessionRunsForRuntimeOperation(
  database: D1Database,
  input: {
    readonly error: RunError;
    readonly operationId: RuntimeOperationId;
    readonly runIds: readonly SessionRunId[];
  },
): Promise<NonTerminalSessionRunsStatusUpdateResult> {
  const runIds = [...new Set(input.runIds)].filter((runId) => runId !== "");

  if (runIds.length === 0) {
    return {
      runIds: [],
      timestampMs: currentTimestampMs(),
    };
  }

  const cancelledRunIds = new Set<SessionRunId>();
  let timestampMs = currentTimestampMs();

  for (let index = 0; index < runIds.length; index += SESSION_RUN_STATUS_WRITE_BATCH_SIZE) {
    const runIdBatch = runIds.slice(index, index + SESSION_RUN_STATUS_WRITE_BATCH_SIZE);
    const updated = await setNonTerminalSessionRunsStatus(database, {
      error: input.error,
      operationId: input.operationId,
      preserveSessionLifecycle: true,
      runIds: runIdBatch,
      source: "runtime_operation",
      status: "cancelled",
    });
    timestampMs = updated.timestampMs;

    const rows = await getAppDatabase(database)
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          inArray(sessionRunsTable.id, runIdBatch),
          eq(sessionRunsTable.status, "cancelled"),
          eq(sessionRunsTable.statusOperationId, input.operationId),
        ),
      )
      .all();

    for (const row of rows) {
      cancelledRunIds.add(row.id);
    }
  }

  return {
    runIds: [...cancelledRunIds],
    timestampMs,
  };
}

async function setNonTerminalSessionRunsStatus(
  database: D1Database,
  input: SessionRunStatusUpdateInput & {
    readonly preserveSessionLifecycle?: boolean;
    readonly runIds: readonly SessionRunId[];
  },
): Promise<NonTerminalSessionRunsStatusUpdateResult> {
  const runIds = [...new Set(input.runIds)].filter((runId) => runId !== "");
  const timestampMs = currentTimestampMs();

  if (runIds.length === 0) {
    return {
      runIds: [],
      timestampMs,
    };
  }

  const updatedRuns = await getAppDatabase(database)
    .update(sessionRunsTable)
    .set(createSessionRunStatusUpdate(input, timestampMs))
    .where(
      and(
        inArray(sessionRunsTable.id, runIds),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    )
    .returning({
      id: sessionRunsTable.id,
      sessionId: sessionRunsTable.sessionId,
    })
    .all();

  if (input.preserveSessionLifecycle === true || updatedRuns.length === 0) {
    return {
      runIds: updatedRuns.map((run) => run.id),
      timestampMs,
    };
  }

  await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: toSessionLifecycleStatusForRunStatus(input.status),
        timestampMs,
      }),
    )
    .where(
      and(
        inArray(
          sessionsTable.id,
          updatedRuns.map((run) => run.sessionId),
        ),
        inArray(
          sessionsTable.lastRunId,
          updatedRuns.map((run) => run.id),
        ),
        notInArray(sessionsTable.status, ["TERMINATED"]),
      ),
    )
    .run();

  return {
    runIds: updatedRuns.map((run) => run.id),
    timestampMs,
  };
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

  if (input.current.session_status === projectedStatus) {
    return "already_projected";
  }

  if (input.current.session_status === "TERMINATED") {
    return "already_projected";
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
      if (input.preserveSessionLifecycle !== true) {
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

  const runUpdateValues = createSessionRunStatusUpdate(input, timestampMs);

  const runUpdateResult = await getAppDatabase(database)
    .update(sessionRunsTable)
    .set(runUpdateValues)
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

  const run = toUpdatedSessionRunSummary(current, input, timestampMs);
  const statusSeq = current.status_seq + 1;

  if (input.preserveSessionLifecycle === true) {
    return {
      kind: "applied",
      previousStatus: current.status,
      run,
      sessionLifecycle: "preserved",
      statusSeq,
    };
  }

  if (current.session_last_run_id !== input.runId) {
    return {
      kind: "applied",
      previousStatus: current.status,
      run,
      sessionLifecycle: "not_current_last_run",
      statusSeq,
    };
  }

  const sessionUpdateResult = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: toSessionLifecycleStatusForRunStatus(input.status),
        timestampMs,
      }),
    )
    .where(
      and(
        eq(sessionsTable.id, current.session_id),
        eq(sessionsTable.lastRunId, input.runId),
        notInArray(sessionsTable.status, ["TERMINATED"]),
      ),
    )
    .run();

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
