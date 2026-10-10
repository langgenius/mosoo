import type {
  SessionRuntimeOperationInput,
  SessionRuntimeOperationName,
  SessionRuntimeOperationResult,
} from "@mosoo/contracts/session";
import type { RunError } from "@mosoo/contracts/session-run";
import {
  nativeResumeRefsTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, createApiError, forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import {
  appendSessionRuntimeEvents,
  createSessionRuntimeEvent,
} from "../../sessions/application/session-event-write.service";
import { assertPreviewAvailable } from "../../sessions/infrastructure/preview-retention.repository";
import { noNativeCheckpointInvalidation } from "../infrastructure/native-resume-ref.repository";
import { stopRuntimeSubjectDrivers } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-driver-stop";
import { recreateRuntimeSubjectPreservingState } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-operations.service";
import { createSessionStatusTransitionPatch } from "../infrastructure/session-runs/session-lifecycle-projection.repository";
import { isSessionTerminalCheckpointReadyForNextRun } from "../infrastructure/session-runs/session-run-admission.repository";
import {
  cancelActiveSessionRunsForRuntimeOperation,
  getSessionRunSummary,
} from "../infrastructure/session-runs/session-run-store.repository";
import { createCancelledSessionRunRuntimeEvent } from "./session-runs/session-run-view-events.service";

const RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR: RunError = {
  code: "agent.runtime_state_operation",
  details: {},
  message: "Agent runtime operation interrupted the active run.",
  retryable: true,
};

interface SessionRuntimeOperationTarget {
  readonly agentId: AgentId | null;
  readonly lastRunId: SessionRunId | null;
  readonly runtimeSubjectId: SandboxId;
  readonly sessionId: SessionId;
  readonly status: "IDLE" | "RUNNING";
  readonly statusSeq: number;
}

function sessionRuntimeOperationUnavailable(message: string) {
  return createApiError(API_ERROR_CODE.sessionRuntimeOperationUnavailable, message);
}

async function resolveSessionRuntimeOperationTarget(
  database: D1Database,
  input: SessionRuntimeOperationInput & { readonly executionOwnerUserId: AccountId },
): Promise<SessionRuntimeOperationTarget | null> {
  const row = await getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      archivedAt: sessionsTable.archivedAt,
      lastRunId: sessionsTable.lastRunId,
      nativeCheckpointInvalidatedAt: nativeResumeRefsTable.invalidatedAt,
      runtimeSubjectId: sandboxesTable.id,
      sandboxId: sandboxSessionsTable.sandboxId,
      sandboxProjectId: sandboxesTable.projectId,
      sandboxOwnerId: sandboxesTable.ownerAccountId,
      subjectId: sandboxesTable.subjectId,
      subjectKind: sandboxesTable.subjectKind,
      status: sessionsTable.status,
      statusOperationId: sessionsTable.statusOperationId,
      statusSeq: sessionsTable.statusSeq,
      peerCount: sql<number>`(SELECT COUNT(*) FROM sandbox_session AS peer WHERE peer.sandbox_id = ${sandboxSessionsTable.sandboxId})`,
    })
    .from(sessionsTable)
    .leftJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .leftJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
    .leftJoin(nativeResumeRefsTable, eq(nativeResumeRefsTable.sessionId, sessionsTable.id))
    .where(and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)))
    .get();

  if (!row) throw forbiddenError();
  const { status } = row;
  if (
    row.archivedAt !== null ||
    row.statusOperationId !== null ||
    (status !== "IDLE" && status !== "RUNNING")
  ) {
    throw sessionRuntimeOperationUnavailable(
      "Session is archived, stopped, or already undergoing maintenance.",
    );
  }
  if (row.nativeCheckpointInvalidatedAt !== null) {
    throw createApiError(
      API_ERROR_CODE.sessionRunCheckpointPending,
      "Session maintenance must wait for a successful native checkpoint after reset.",
    );
  }
  if (row.sandboxId === null) {
    if (status !== "IDLE") {
      throw sessionRuntimeOperationUnavailable(
        "Session has no admitted execution resource to maintain.",
      );
    }
    return null;
  }
  if (
    row.runtimeSubjectId === null ||
    row.subjectKind !== "session" ||
    row.subjectId !== input.sessionId ||
    row.sandboxProjectId !== input.projectId ||
    row.sandboxOwnerId !== input.executionOwnerUserId ||
    row.peerCount !== 1
  ) {
    throw sessionRuntimeOperationUnavailable(
      "Session does not have a verified exclusive execution resource.",
    );
  }
  return {
    agentId: row.agentId,
    lastRunId: row.lastRunId,
    runtimeSubjectId: row.runtimeSubjectId,
    sessionId: input.sessionId,
    status,
    statusSeq: row.statusSeq,
  };
}

async function appendOperationEvent(
  bindings: ApiBindings,
  input: {
    readonly operation: SessionRuntimeOperationName;
    readonly operationId: RuntimeOperationId;
    readonly status: "ready" | "updating";
    readonly target: SessionRuntimeOperationTarget;
  },
): Promise<void> {
  const observedAt = new Date().toISOString();
  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createSessionRuntimeEvent({
        kind: "agent.task.updated",
        payload: {
          agentId: input.target.agentId,
          operation: input.operation,
          operationId: input.operationId,
          ...(input.status === "ready" ? { readyAt: observedAt } : { startedAt: observedAt }),
          status: input.status,
        },
        sessionId: input.target.sessionId,
      }),
    ],
    sessionId: input.target.sessionId,
  });
}

// Success and failure end the same way: the Session is IDLE again and the Run
// the operation interrupted is cancelled and reported.
async function finishSessionRuntimeOperation(
  bindings: ApiBindings,
  input: {
    readonly operation: SessionRuntimeOperationName;
    readonly operationId: RuntimeOperationId;
    readonly target: SessionRuntimeOperationTarget;
  },
): Promise<void> {
  const { operationId, target } = input;
  const finished = await getAppDatabase(bindings.DB)
    .update(sessionsTable)
    .set(createSessionStatusTransitionPatch({ status: "IDLE", timestampMs: currentTimestampMs() }))
    .where(
      and(
        eq(sessionsTable.id, target.sessionId),
        isNull(sessionsTable.archivedAt),
        eq(sessionsTable.status, "RESCHEDULING"),
        eq(sessionsTable.statusOperationId, operationId),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();
  if (!finished) return;

  if (target.status === "RUNNING" && target.lastRunId !== null) {
    const cancelled = await cancelActiveSessionRunsForRuntimeOperation(bindings.DB, {
      error: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
      operationId,
      runIds: [target.lastRunId],
    });
    const run =
      cancelled.runIds.length === 0
        ? null
        : await getSessionRunSummary(bindings.DB, target.lastRunId);
    if (run) {
      await appendSessionRuntimeEvents({
        bindings,
        events: [
          createCancelledSessionRunRuntimeEvent({
            run,
            runError: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
            sessionId: target.sessionId,
            sourceEventId: `runtime-operation:${operationId}:${run.id}:interrupted`,
          }),
        ],
        sessionId: target.sessionId,
      });
    }
  }
  await appendOperationEvent(bindings, { ...input, status: "ready" });
}

async function executeSessionRuntimeOperation(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
  operation: SessionRuntimeOperationName,
): Promise<SessionRuntimeOperationResult> {
  const project = await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const target = await resolveSessionRuntimeOperationTarget(bindings.DB, {
    ...input,
    executionOwnerUserId: project.ownerAccountId,
  });
  await assertPreviewAvailable(bindings.DB, input.sessionId, Date.now());
  if (!(await isSessionTerminalCheckpointReadyForNextRun(bindings.DB, input.sessionId))) {
    throw createApiError(
      API_ERROR_CODE.sessionRunCheckpointPending,
      "Session maintenance must wait for its successful turn checkpoint and history.",
    );
  }
  if (target === null) {
    return { ok: true, sessionId: input.sessionId };
  }

  // A Run or status change since the checks above makes this compare-and-set miss.
  const operationId = createPlatformId<RuntimeOperationId>();
  const admitted = await getAppDatabase(bindings.DB)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        operationId,
        status: "RESCHEDULING",
        timestampMs: currentTimestampMs(),
      }),
    )
    .where(
      and(
        eq(sessionsTable.id, target.sessionId),
        isNull(sessionsTable.archivedAt),
        eq(sessionsTable.status, target.status),
        eq(sessionsTable.statusSeq, target.statusSeq),
        target.lastRunId === null
          ? isNull(sessionsTable.lastRunId)
          : eq(sessionsTable.lastRunId, target.lastRunId),
        isNull(sessionsTable.statusOperationId),
        noNativeCheckpointInvalidation(getAppDatabase(bindings.DB), target.sessionId),
      ),
    )
    .returning({ id: sessionsTable.id })
    .get();
  if (!admitted) {
    throw sessionRuntimeOperationUnavailable(
      "Session changed before maintenance could be admitted.",
    );
  }

  const context = { operation, operationId, target };
  const subjectOperation = {
    operationId,
    reason: "session.runtime_state_operation",
    runtimeSubjectId: target.runtimeSubjectId,
    targets: [{ sessionId: target.sessionId }],
    terminalRun: { error: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR, status: "cancelled" as const },
  };
  try {
    await appendOperationEvent(bindings, { ...context, status: "updating" });
    if (operation === "restartDriver") {
      await stopRuntimeSubjectDrivers(bindings, {
        ...subjectOperation,
        preserveSessionLifecycle: true,
      });
    } else {
      await recreateRuntimeSubjectPreservingState(bindings, subjectOperation);
    }
  } finally {
    await finishSessionRuntimeOperation(bindings, context);
  }
  return { ok: true, sessionId: input.sessionId };
}

export function restartSessionDriver(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
) {
  return executeSessionRuntimeOperation(bindings, viewer, input, "restartDriver");
}

export function recreateSessionSandbox(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SessionRuntimeOperationInput,
) {
  return executeSessionRuntimeOperation(bindings, viewer, input, "recreateSandbox");
}
