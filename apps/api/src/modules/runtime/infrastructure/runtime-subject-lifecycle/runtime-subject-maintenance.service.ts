import { sessionsTable } from "@mosoo/db";
import type { SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTruthy } from "../../../../shared/truthiness";
import { toIsoString } from "../../../../time";
import { repairStaleSessionDeleteCleanups } from "../../../sessions/application/session-cleanup.service";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../../sessions/domain/session-lifecycle";
import { createSessionLifecycleTerminatedEvent } from "../../application/session-runs/session-run-view-events.service";
import { cleanupDriverInstances } from "../driver-instance/maintenance";
import { repairRuntimeCommandRecords } from "../session-runs/runtime-command-store.repository";
import { createSessionStatusTransitionPatch } from "../session-runs/session-lifecycle-projection.repository";
import { setSessionRunStatus } from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import {
  claimInactiveRuntimeSubject,
  listInactiveRuntimeSubjects,
  listStaleRuntimeSubjectOperations,
} from "./runtime-subject-store";
import type {
  RuntimeSubjectMaintenanceCandidate,
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
  try {
    await input.resumeRuntimeSubjectRecycleOperation(bindings, {
      kind: input.candidate.kind,
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

export async function runSandboxMaintenance(bindings: ApiBindings): Promise<void> {
  const now = Date.now();

  await repairRuntimeCommandRecords(bindings.DB, { nowMs: now });
  await cleanupDriverInstances(bindings);
  await expireStaleReschedulingSessions(bindings);
  await repairStaleSessionDeleteCleanups(bindings, {
    limit: MAINTENANCE_BATCH_SIZE,
    staleUpdatedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
  });

  const [candidates, repairCandidates] = await Promise.all([
    listInactiveRuntimeSubjects(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      now,
    }),
    listStaleRuntimeSubjectOperations(bindings.DB, {
      limit: MAINTENANCE_BATCH_SIZE,
      staleChangedAtLte: now - MAINTENANCE_OPERATION_REPAIR_AFTER_MS,
    }),
  ]);

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
