import { sessionsTable } from "@mosoo/db";
import type { SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, isNull, lte } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { toIsoString } from "../../../../time";
import { repairStaleSessionDeleteCleanups } from "../../../sessions/application/session-cleanup.service";
import { publishPersistedSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { repairStaleSessionArchiveCleanups } from "../../../sessions/application/session-lifecycle-mutation.service";
import { syncSessionViewerState } from "../../../sessions/application/session-viewer-events.service";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../../sessions/domain/session-lifecycle";
import { writeRuntimeOperationTimedOutSnapshots } from "../../application/runtime-state-operation-target-events";
import {
  commitSessionLifecycleEventProjection,
  listStaleRuntimeOperationTargets,
} from "../../application/runtime-state-operation-target-store";
import { recordCanonicalSessionRunTerminal } from "../../application/session-runs/session-run-terminal-failure.service";
import { createSessionLifecycleTerminatedEvent } from "../../application/session-runs/session-run-view-events.service";
import { reconcileStaleActiveSessionRuns } from "../../application/session-runs/stale-run-reconciliation.service";
import { reconcileTerminalSessionRuns } from "../../application/session-runs/terminal-run-reconciliation.service";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { cleanupDriverInstances } from "../driver-instance/maintenance";
import { cleanupRuntimeArtifactAttempts } from "../driver-instance/runtime-artifact-attempt.repository";
import { repairStagedSandboxBackups } from "../sandbox-backup.service";
import { repairRuntimeCommandRecords } from "../session-runs/runtime-command-store.repository";
import { getSessionRunSummariesByIds } from "../session-runs/session-run-store.repository";
import { listIdleSessionScopedConversationSessions } from "./runtime-conversation-session-store";
import {
  cleanupRuntimeProvisioningResources,
  retireRuntimeProvisioningIncarnation,
} from "./runtime-provisioning-cleanup.service";
import {
  adoptReadyRuntimeRunProvisioningLease,
  claimStaleRuntimeProvisioningLeases,
  releaseAbortedRuntimeProvisioningLease,
} from "./runtime-provisioning-lease-store";
import { repairStrandedRuntimeSubjectDeadlines } from "./runtime-subject-maintenance-store";
import {
  claimInactiveRuntimeSubject,
  claimRuntimeSubjectOperationForRepair,
  listInactiveRuntimeSubjects,
  listStaleRuntimeSubjectOperations,
} from "./runtime-subject-store";
import type {
  RuntimeSubjectMaintenanceCandidate,
  RuntimeSubjectOperationLease,
  RuntimeSubjectOperationRepairCandidate,
} from "./runtime-subject-store";

const MAINTENANCE_CLAIM_TTL_MS = 10 * 60_000;
const MAINTENANCE_BATCH_SIZE = 20;
const MAINTENANCE_OPERATION_REPAIR_AFTER_MS = 10 * 60_000;
const RESCHEDULING_TIMEOUT_DB_BATCH_SIZE = 50;
const RESCHEDULING_TIMEOUT_IO_BATCH_SIZE = 10;
type RecycleRuntimeSubject = (
  bindings: ApiBindings,
  input: {
    readonly claimOwner: string;
    readonly kind: RuntimeSubjectMaintenanceCandidate["kind"];
    readonly now: number;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
) => Promise<boolean>;
type ResumeRuntimeSubjectRecycleOperation = (
  bindings: ApiBindings,
  input: {
    readonly kind: RuntimeSubjectOperationRepairCandidate["kind"];
    readonly lease: RuntimeSubjectOperationLease;
    readonly reason: string;
    readonly runtimeSubjectId: RuntimeSubjectOperationRepairCandidate["id"];
  },
) => Promise<boolean>;

interface StaleReschedulingSessionRow {
  id: SessionId;
  last_run_id: SessionRunId | null;
  runtime_event_seq_cursor: number;
  status_seq: number;
  updated_at: number;
}

const RESCHEDULING_TIMEOUT_ERROR = {
  code: "session.rescheduling_timeout",
  details: {},
  message: "Session could not reconnect within 120 seconds.",
  retryable: false,
} as const;

async function processInBatches<T>(
  items: readonly T[],
  batchSize: number,
  task: (item: T) => Promise<void>,
  onRejected: (item: T, reason: unknown) => void,
): Promise<void> {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const outcomes = await Promise.allSettled(batch.map(task));
    for (const [outcomeIndex, outcome] of outcomes.entries()) {
      if (outcome.status === "rejected") {
        const item = batch[outcomeIndex];
        if (item !== undefined) {
          onRejected(item, outcome.reason);
        }
      }
    }
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
      kind: input.candidate.kind,
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
  const now = Date.now();
  const lease = await claimRuntimeSubjectOperationForRepair(bindings.DB, {
    candidate: input.candidate,
    claimExpiresAt: now + MAINTENANCE_CLAIM_TTL_MS,
    claimOwner: `repair-${crypto.randomUUID()}`,
    now,
  });
  if (lease === null) {
    return;
  }

  try {
    await input.resumeRuntimeSubjectRecycleOperation(bindings, {
      kind: input.candidate.kind,
      lease,
      reason: input.reason,
      runtimeSubjectId: input.candidate.id,
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

async function commitReschedulingTimeoutProjection(
  bindings: ApiBindings,
  target: StaleReschedulingSessionRow,
): Promise<void> {
  const stoppedAt = target.updated_at + RESCHEDULING_RECONNECT_WINDOW_MS;
  const event = createSessionLifecycleTerminatedEvent({
    lastSeen: toIsoString(stoppedAt),
    message: RESCHEDULING_TIMEOUT_ERROR.message,
    occurredAtMs: stoppedAt,
    reason: RESCHEDULING_TIMEOUT_ERROR.code,
    sessionId: target.id,
    sourceEventId: `maintenance:rescheduling-timeout:${target.id}`,
  });

  const outcome = await commitSessionLifecycleEventProjection(bindings.DB, {
    event,
    status: "TERMINATED",
    target: {
      lastRunId: target.last_run_id,
      sessionId: target.id,
      sessionRuntimeEventSeqCursor: target.runtime_event_seq_cursor,
      sessionStatus: "RESCHEDULING",
      sessionStatusOperationId: null,
      sessionStatusSeq: target.status_seq,
      sessionUpdatedAt: target.updated_at,
    },
    timestampMs: stoppedAt,
  });
  if (outcome.kind !== "stale") {
    await publishPersistedSessionRuntimeEvents({ bindings, events: [event], sessionId: target.id });
  }
}

export async function expireStaleReschedulingSessions(bindings: ApiBindings): Promise<void> {
  const now = Date.now();
  const staleSessions = await getAppDatabase(bindings.DB)
    .select({
      id: sessionsTable.id,
      last_run_id: sessionsTable.lastRunId,
      runtime_event_seq_cursor: sessionsTable.runtimeEventSeqCursor,
      status_seq: sessionsTable.statusSeq,
      updated_at: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.status, "RESCHEDULING"),
        isNull(sessionsTable.archivedAt),
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

  const runIds = staleSessions.flatMap((target) =>
    target.last_run_id === null ? [] : [target.last_run_id],
  );
  const runsById = await getSessionRunSummariesByIds(bindings.DB, runIds);

  await processInBatches(
    staleSessions,
    RESCHEDULING_TIMEOUT_IO_BATCH_SIZE,
    async (target) => {
      const run = target.last_run_id === null ? null : (runsById.get(target.last_run_id) ?? null);
      if (run !== null && !["cancelled", "completed", "expired", "failed"].includes(run.status)) {
        await recordCanonicalSessionRunTerminal(bindings, {
          assistantMessage: null,
          error: RESCHEDULING_TIMEOUT_ERROR,
          expectedSessionOperationId: null,
          expectedSessionObservation: {
            lastRunId: target.last_run_id,
            status: "RESCHEDULING",
            statusSeq: target.status_seq,
            updatedAt: target.updated_at,
          },
          lifecycle: "TERMINATED",
          runId: run.id,
          sessionId: target.id,
          source: "maintenance",
          status: "failed",
          timestampMs: target.updated_at + RESCHEDULING_RECONNECT_WINDOW_MS,
        });
        return;
      }

      await commitReschedulingTimeoutProjection(bindings, target);
    },
    (target, reason) => {
      logWarn("runtime.session.rescheduling_timeout_repair_failed", {
        ...createErrorLogContext(reason),
        sessionId: target.id,
      });
    },
  );
}

export async function repairStaleRuntimeOperationTargets(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
    readonly staleUpdatedAtLte: number;
  },
): Promise<number> {
  const targets = await listStaleRuntimeOperationTargets(bindings.DB, input);

  await Promise.all(
    [...Map.groupBy(targets, (target) => target.operationId)].map(
      async ([operationId, operationTargets]) => {
        try {
          await writeRuntimeOperationTimedOutSnapshots(bindings, {
            operationId,
            targets: operationTargets,
          });
        } catch (error) {
          logWarn("runtime.operation.timeout_repair_failed", {
            ...createErrorLogContext(error),
            operationId,
            sessionIds: operationTargets.map((target) => target.sessionId),
          });
        }
      },
    ),
  );

  return targets.length;
}

// Cattle conversations no longer close on run terminal (the resident driver is
// what makes follow-up turns warm), so this sweep is what ends them: close the
// ones quiet past the cattle idle grace, which arms the subject inactive
// deadline and hands the container to the existing subject reclamation pass.
async function closeIdleSessionScopedConversationSessions(
  bindings: ApiBindings,
  now: number,
): Promise<void> {
  const idleGraceMs = getRuntimeKindPolicy("cattle").subject.idleReleaseDelayMs;
  const idleSinceLte = now - idleGraceMs;
  const idle = await listIdleSessionScopedConversationSessions(bindings.DB, {
    idleSinceLte,
    limit: MAINTENANCE_BATCH_SIZE,
  });
  const { closeIdleCattleConversationSession } = await import("../sandbox-session.service");

  for (const conversation of idle) {
    try {
      // Atomic claim inside: closes only if the row is still the same, idle,
      // lease-free session — a follow-up turn that re-used it since the list
      // snapshot makes the claim lose and is left running.
      await closeIdleCattleConversationSession(bindings, {
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

async function repairPendingConversationSessionCleanups(bindings: ApiBindings): Promise<void> {
  const { repairPendingSandboxConversationSessionCleanups } =
    await import("../sandbox-session.service");
  try {
    await repairPendingSandboxConversationSessionCleanups(bindings, MAINTENANCE_BATCH_SIZE);
  } catch (error) {
    logWarn("runtime.conversation.cleanup_repair_failed", createErrorLogContext(error));
  }
}

export async function repairStaleRuntimeProvisioningLeases(
  bindings: ApiBindings,
  input: { readonly heartbeatAtLte: number; readonly limit: number },
): Promise<number> {
  const claims = await claimStaleRuntimeProvisioningLeases(bindings.DB, input);

  await Promise.allSettled(
    claims.map(async (claim) => {
      try {
        if (await adoptReadyRuntimeRunProvisioningLease(bindings.DB, claim)) {
          return;
        }
        if (claim.sandboxIncarnation === null) {
          await cleanupRuntimeProvisioningResources(bindings, claim, "maintenance");
          if (!(await releaseAbortedRuntimeProvisioningLease(bindings.DB, claim))) {
            throw new Error("Runtime provisioning repair lost its maintenance ownership.");
          }
        } else {
          await retireRuntimeProvisioningIncarnation(bindings, claim, "maintenance");
        }
      } catch (error) {
        logWarn("runtime.provisioning.repair_failed", {
          ...createErrorLogContext(error),
          operationId: claim.operationId,
          runId: claim.runId,
          sandboxId: claim.sandboxId,
          sessionId: claim.sessionId,
        });
      }
    }),
  );

  return claims.length;
}

export async function runSandboxMaintenance(bindings: ApiBindings): Promise<void> {
  const now = Date.now();

  await repairStaleRuntimeProvisioningLeases(bindings, {
    heartbeatAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    limit: MAINTENANCE_BATCH_SIZE,
  });
  await repairStagedSandboxBackups(bindings, MAINTENANCE_BATCH_SIZE);
  const cleanupRepairs = await Promise.allSettled([
    repairStaleSessionArchiveCleanups(bindings, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleUpdatedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
    repairStaleSessionDeleteCleanups(bindings, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleUpdatedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
  ]);
  const cleanupRepairFailure = cleanupRepairs.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (cleanupRepairFailure !== undefined) {
    logWarn(
      "runtime.session.cleanup_repair_failed",
      createErrorLogContext(cleanupRepairFailure.reason),
    );
  }
  await repairStaleRuntimeOperationTargets(bindings, {
    limit: MAINTENANCE_BATCH_SIZE,
    staleUpdatedAtLte: now - RESCHEDULING_RECONNECT_WINDOW_MS,
  });
  await cleanupDriverInstances(bindings);
  await repairRuntimeCommandRecords(bindings.DB, { nowMs: now });
  const staleRunReconciliation = await reconcileStaleActiveSessionRuns(bindings.DB, {
    limit: MAINTENANCE_BATCH_SIZE,
  });
  const terminalRunReconciliation = await reconcileTerminalSessionRuns(bindings, {
    limit: MAINTENANCE_BATCH_SIZE,
  });
  await processInBatches(
    [
      ...new Set([
        ...staleRunReconciliation.reconciledSessionIds,
        ...terminalRunReconciliation.reconciledSessionIds,
      ]),
    ],
    RESCHEDULING_TIMEOUT_IO_BATCH_SIZE,
    async (sessionId) => syncSessionViewerState(bindings, sessionId),
    (sessionId, reason) => {
      logWarn("runtime.session.viewer_state_repair_failed", {
        ...createErrorLogContext(reason),
        sessionId,
      });
    },
  );
  await expireStaleReschedulingSessions(bindings);
  await repairPendingConversationSessionCleanups(bindings);
  await closeIdleSessionScopedConversationSessions(bindings, now);
  const repairedDeadlines = await repairStrandedRuntimeSubjectDeadlines(bindings.DB, { now });

  if (repairedDeadlines.cattle > 0) {
    logWarn("runtime.subject.inactive_deadline_repaired", { count: repairedDeadlines.cattle });
  }

  // A repaired pet is an orphan that was billing with no live driver and no
  // active run — a distinct alert signal from routine resident-cattle repair.
  if (repairedDeadlines.pet > 0) {
    logWarn("runtime.subject.orphan_pet_deadline_repaired", { count: repairedDeadlines.pet });
  }

  const [candidates, repairCandidates] = await Promise.all([
    listInactiveRuntimeSubjects(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      now,
    }),
    listStaleRuntimeSubjectOperations(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleChangedAtLte: now,
    }),
  ]);

  try {
    await cleanupRuntimeArtifactAttempts(bindings);
  } catch (error) {
    logWarn("runtime.artifact.cleanup_failed", createErrorLogContext(error));
  }

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
