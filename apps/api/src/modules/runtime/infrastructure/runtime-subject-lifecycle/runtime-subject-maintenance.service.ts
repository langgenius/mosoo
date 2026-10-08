import { sessionsTable } from "@mosoo/db";
import type { SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import { createErrorLogContext, logError, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTruthy } from "../../../../shared/truthiness";
import { toIsoString } from "../../../../time";
import {
  cleanupExpiredPreviewSessions,
  repairStaleSessionDeleteCleanups,
} from "../../../sessions/application/session-cleanup.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { syncSessionViewerState } from "../../../sessions/application/session-viewer-events.service";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../../sessions/domain/session-lifecycle";
import { stopOverdueSessionRuns } from "../../application/session-runs/session-run-time-limit.service";
import { createSessionLifecycleTerminatedEvent } from "../../application/session-runs/session-run-view-events.service";
import { reconcileStaleActiveSessionRuns } from "../../application/session-runs/stale-run-reconciliation.service";
import { reconcileTerminalSessionRuns } from "../../application/session-runs/terminal-run-reconciliation.service";
import { SESSION_RUNTIME_IDLE_GRACE_MS } from "../../domain/session-runtime-policy";
import { cleanupDriverInstances } from "../driver-instance/maintenance";
import { createSandboxCheckpoints } from "../sandbox-backup.service";
import { repairRuntimeCommandRecords } from "../session-runs/runtime-command-store.repository";
import { createSessionStatusTransitionPatch } from "../session-runs/session-lifecycle-projection.repository";
import { setSessionRunStatus } from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import {
  listPendingIdleConversationCheckpoints,
  listIdleSessionScopedConversationSessions,
} from "./runtime-conversation-session-store";
import { repairStrandedRuntimeSubjectDeadlines } from "./runtime-subject-maintenance-store";
import {
  claimInactiveRuntimeSubject,
  claimExpiredRuntimeSubjectActivations,
  listInactiveRuntimeSubjects,
  listStaleRuntimeSubjectOperations,
} from "./runtime-subject-store";
import type {
  RuntimeSubjectMaintenanceCandidate,
  RuntimeSubjectOperationRepairCandidate,
} from "./runtime-subject-store";

const MAINTENANCE_CLAIM_TTL_MS = 10 * 60_000;
const MAINTENANCE_BATCH_SIZE = 20;
// Checkpoints are the slow step. The budget keeps one sweep well inside the
// 15-minute Queue consumer limit; unstarted candidates wait for the next minute.
const MAINTENANCE_CHECKPOINT_REPAIR_BUDGET_MS = 5 * 60_000;
const MAINTENANCE_OPERATION_REPAIR_AFTER_MS = 10 * 60_000;
const RESCHEDULING_TIMEOUT_DB_BATCH_SIZE = 50;
const RESCHEDULING_TIMEOUT_IO_BATCH_SIZE = 10;
type RecycleRuntimeSubject = (
  bindings: ApiBindings,
  input: {
    readonly claimOwner: string;
    readonly now: number;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
) => Promise<boolean>;
type ResumeRuntimeSubjectRecycleOperation = (
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeSubjectOperationRepairCandidate["operationId"];
    readonly reason: string;
    readonly runtimeSubjectId: RuntimeSubjectOperationRepairCandidate["id"];
    readonly status: RuntimeSubjectOperationRepairCandidate["status"];
  },
) => Promise<boolean>;

interface StaleReschedulingSessionRow {
  id: SessionId;
  last_run_id: SessionRunId | null;
}

const RESCHEDULING_TIMEOUT_ERROR = {
  code: "session.rescheduling_timeout",
  details: {},
  message: "Session could not reconnect within 120 seconds.",
  retryable: false,
} as const;

function assertMaintenanceRunTransition(outcome: SessionRunTransitionOutcome): void {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return;
    }
    case "stale": {
      if (outcome.reason === "terminal_run") {
        return;
      }
      throw new Error("Rescheduling timeout lost a concurrent run transition.");
    }
    case "repair_needed": {
      throw new Error("Rescheduling timeout left session projection stale.");
    }
    case "rejected": {
      throw new Error(`Rescheduling timeout run transition was rejected: ${outcome.reason}.`);
    }
  }
}

async function processInBatches<T>(
  items: readonly T[],
  batchSize: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(task));
  }
}

async function recycleInactiveRuntimeSubjectCandidate(
  bindings: ApiBindings,
  input: {
    readonly claimOwner: string;
    readonly candidate: RuntimeSubjectMaintenanceCandidate;
    readonly now: number;
    readonly reason: string;
    readonly recycleRuntimeSubject: RecycleRuntimeSubject;
  },
): Promise<void> {
  const claimed = await claimInactiveRuntimeSubject(bindings.DB, {
    claimExpiresAt: input.now + MAINTENANCE_CLAIM_TTL_MS,
    claimOwner: input.claimOwner,
    now: input.now,
    runtimeSubjectId: input.candidate.id,
  });

  if (!claimed) {
    return;
  }

  try {
    await input.recycleRuntimeSubject(bindings, {
      claimOwner: input.claimOwner,
      now: input.now,
      reason: input.reason,
      runtimeSubjectId: input.candidate.id,
    });
  } catch (error) {
    logWarn("runtime.subject.maintenance.recycle_failed", {
      ...createErrorLogContext(error),
      runtimeSubjectId: input.candidate.id,
    });
  }
}

async function repairRuntimeSubjectOperationCandidate(
  bindings: ApiBindings,
  input: {
    readonly candidate: RuntimeSubjectOperationRepairCandidate;
    readonly reason: string;
    readonly resumeRuntimeSubjectRecycleOperation: ResumeRuntimeSubjectRecycleOperation;
  },
): Promise<void> {
  try {
    await input.resumeRuntimeSubjectRecycleOperation(bindings, {
      operationId: input.candidate.operationId,
      reason: input.reason,
      runtimeSubjectId: input.candidate.id,
      status: input.candidate.status,
    });
  } catch (error) {
    logWarn("runtime.subject.maintenance.operation_repair_failed", {
      ...createErrorLogContext(error),
      operationId: input.candidate.operationId,
      runtimeSubjectId: input.candidate.id,
      status: input.candidate.status,
    });
  }
}

async function publishReschedulingTimeoutEvent(
  bindings: ApiBindings,
  target: StaleReschedulingSessionRow,
): Promise<void> {
  const stoppedAt = Date.now();
  const event = createSessionLifecycleTerminatedEvent({
    lastSeen: toIsoString(stoppedAt),
    message: RESCHEDULING_TIMEOUT_ERROR.message,
    reason: RESCHEDULING_TIMEOUT_ERROR.code,
    sessionId: target.id,
  });

  await appendSessionRuntimeEvents({
    bindings,
    events: [event],
    sessionId: target.id,
  });
}

export async function expireStaleReschedulingSessions(bindings: ApiBindings): Promise<void> {
  const now = Date.now();
  const staleSessions = await getAppDatabase(bindings.DB)
    .select({
      id: sessionsTable.id,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.status, "RESCHEDULING"),
        isNull(sessionsTable.statusOperationId),
        lte(sessionsTable.updatedAt, now - RESCHEDULING_RECONNECT_WINDOW_MS),
      ),
    )
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(RESCHEDULING_TIMEOUT_DB_BATCH_SIZE)
    .all();

  if (staleSessions.length === 0) {
    return;
  }

  const results = await getAppDatabase(bindings.DB)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: "TERMINATED",
        timestampMs: now,
      }),
    )
    .where(
      and(
        inArray(
          sessionsTable.id,
          staleSessions.map((session) => session.id),
        ),
        eq(sessionsTable.status, "RESCHEDULING"),
        isNull(sessionsTable.statusOperationId),
        lte(sessionsTable.updatedAt, now - RESCHEDULING_RECONNECT_WINDOW_MS),
      ),
    )
    .returning({
      id: sessionsTable.id,
      last_run_id: sessionsTable.lastRunId,
    })
    .all();

  await processInBatches(
    results.map((target) => target.last_run_id).filter(isTruthy),
    RESCHEDULING_TIMEOUT_IO_BATCH_SIZE,
    async (runId) => {
      const outcome = await setSessionRunStatus(bindings.DB, {
        error: RESCHEDULING_TIMEOUT_ERROR,
        preserveSessionLifecycle: true,
        runId,
        source: "maintenance",
        status: "failed",
      });
      assertMaintenanceRunTransition(outcome);
    },
  );

  await processInBatches(results, RESCHEDULING_TIMEOUT_IO_BATCH_SIZE, async (target) =>
    publishReschedulingTimeoutEvent(bindings, target),
  );
}

// Session conversations no longer close on run terminal (the resident driver is
// what makes follow-up turns warm), so this sweep is what ends them: close the
// ones quiet past the Session idle grace, which arms the subject inactive
// deadline and hands the container to the existing subject reclamation pass.
async function closeIdleSessionScopedConversationSessions(
  bindings: ApiBindings,
  now: number,
): Promise<void> {
  const idleSinceLte = now - SESSION_RUNTIME_IDLE_GRACE_MS;
  const idle = await listIdleSessionScopedConversationSessions(bindings.DB, {
    idleSinceLte,
    limit: MAINTENANCE_BATCH_SIZE,
  });
  const { closeIdleConversationSession } = await import("../sandbox-session.service");

  for (const conversation of idle) {
    try {
      // Atomic claim inside: closes only if the row is still the same, idle,
      // lease-free session — a follow-up turn that re-used it since the list
      // snapshot makes the claim lose and is left running.
      await closeIdleConversationSession(bindings, {
        idleSinceLte,
        sandboxId: conversation.sandboxId,
        sessionId: conversation.sessionId,
      });
    } catch (error) {
      logWarn("runtime.conversation.idle_close_failed", {
        ...createErrorLogContext(error),
        runtimeSubjectId: conversation.sandboxId,
        sessionId: conversation.sessionId,
      });
    }
  }
}

export async function repairIdleConversationCheckpoints(
  bindings: ApiBindings,
  now: number,
  deadlineMs: number = Number.POSITIVE_INFINITY,
): Promise<void> {
  const pending = await listPendingIdleConversationCheckpoints(bindings.DB, {
    idleSinceLte: now - SESSION_RUNTIME_IDLE_GRACE_MS,
    limit: MAINTENANCE_BATCH_SIZE,
  });
  for (const candidate of pending) {
    if (Date.now() >= deadlineMs) {
      return;
    }

    try {
      await createSandboxCheckpoints(bindings, {
        requiredSessionId: candidate.sessionId,
        sandboxId: candidate.sandboxId,
        sessionRunId: candidate.sessionRunId,
      });
    } catch (error) {
      // Preserve the resident workspace and retry on the next sweep.
      logWarn("runtime.conversation.checkpoint_repair_failed", {
        ...createErrorLogContext(error),
        ...candidate,
      });
    }
  }
}

async function reclaimRuntimeSubjects(bindings: ApiBindings, now: number): Promise<void> {
  const [candidates, staleOperations, expiredActivations] = await Promise.all([
    listInactiveRuntimeSubjects(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      now,
    }),
    listStaleRuntimeSubjectOperations(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleChangedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
    claimExpiredRuntimeSubjectActivations(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      now,
      staleChangedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
  ]);
  const repairCandidates = [...staleOperations, ...expiredActivations];

  if (candidates.length === 0 && repairCandidates.length === 0) {
    return;
  }

  const { recycleRuntimeSubject, resumeRuntimeSubjectRecycleOperation } =
    await import("./runtime-subject-recycle.service");

  await Promise.all(
    candidates.map((candidate) =>
      recycleInactiveRuntimeSubjectCandidate(bindings, {
        candidate,
        claimOwner: `scheduled-${crypto.randomUUID()}`,
        now,
        reason: "runtime_subject.inactive_maintenance",
        recycleRuntimeSubject,
      }),
    ),
  );
  await Promise.all(
    repairCandidates.map((candidate) =>
      repairRuntimeSubjectOperationCandidate(bindings, {
        candidate,
        reason: "runtime_subject.operation_repair",
        resumeRuntimeSubjectRecycleOperation,
      }),
    ),
  );
}

async function syncReconciledSessionViewers(
  bindings: ApiBindings,
  sessionIds: readonly SessionId[],
): Promise<void> {
  await processInBatches(sessionIds, RESCHEDULING_TIMEOUT_IO_BATCH_SIZE, async (sessionId) =>
    syncSessionViewerState(bindings, sessionId),
  );
}

// Each sweep is independent. A row that keeps failing one of them must not stop
// the rest, above all container reclamation; the next minute retries every step.
async function runMaintenanceStep(step: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    logError("runtime.maintenance.step_failed", {
      ...createErrorLogContext(error),
      step,
    });
  }
}

export async function runSandboxMaintenance(bindings: ApiBindings): Promise<void> {
  const now = Date.now();

  // Reclamation and the turn time limit stop container spend, so they run
  // first and no bookkeeping sweep below can delay or block them.
  await runMaintenanceStep("reclaim_runtime_subjects", async () =>
    reclaimRuntimeSubjects(bindings, now),
  );
  await runMaintenanceStep("stop_overdue_runs", async () =>
    stopOverdueSessionRuns(bindings, { limit: MAINTENANCE_BATCH_SIZE, nowMs: now }),
  );
  await runMaintenanceStep("repair_runtime_commands", async () =>
    repairRuntimeCommandRecords(bindings.DB, { nowMs: now }),
  );
  await runMaintenanceStep("cleanup_driver_instances", async () =>
    cleanupDriverInstances(bindings),
  );
  await runMaintenanceStep("reconcile_stale_runs", async () => {
    const reconciliation = await reconcileStaleActiveSessionRuns(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
    });
    await syncReconciledSessionViewers(bindings, reconciliation.reconciledSessionIds);
  });
  await runMaintenanceStep("reconcile_terminal_runs", async () => {
    const reconciliation = await reconcileTerminalSessionRuns(bindings, {
      limit: MAINTENANCE_BATCH_SIZE,
    });
    await syncReconciledSessionViewers(bindings, reconciliation.reconciledSessionIds);
  });
  await runMaintenanceStep("expire_rescheduling_sessions", async () =>
    expireStaleReschedulingSessions(bindings),
  );
  await runMaintenanceStep("repair_session_delete_cleanups", async () =>
    repairStaleSessionDeleteCleanups(bindings, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleUpdatedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
  );
  await runMaintenanceStep("cleanup_expired_previews", async () =>
    cleanupExpiredPreviewSessions(bindings, { limit: MAINTENANCE_BATCH_SIZE, nowMs: now }),
  );
  await runMaintenanceStep("repair_idle_checkpoints", async () =>
    repairIdleConversationCheckpoints(
      bindings,
      now,
      Date.now() + MAINTENANCE_CHECKPOINT_REPAIR_BUDGET_MS,
    ),
  );
  await runMaintenanceStep("close_idle_conversations", async () =>
    closeIdleSessionScopedConversationSessions(bindings, now),
  );
  await runMaintenanceStep("repair_stranded_deadlines", async () => {
    const repairedDeadlines = await repairStrandedRuntimeSubjectDeadlines(bindings.DB, { now });

    if (repairedDeadlines > 0) {
      logWarn("runtime.subject.inactive_deadline_repaired", { count: repairedDeadlines });
    }
  });
}
