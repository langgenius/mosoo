import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionEventsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, RuntimeOperationId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";
import { and, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { publishPersistedSessionRuntimeEvents } from "../../sessions/application/session-event-write.service";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../sessions/domain/session-lifecycle";
import { readTerminalEventSemanticAuthority } from "../../sessions/domain/session-terminal-event-authority";
import type { TerminalEventSemanticAuthority } from "../../sessions/domain/session-terminal-event-authority";
import { adoptTerminalRunProjection } from "../infrastructure/driver-instance/completed-run-commit.repository";
import { listLiveDriverInstanceRefsForSandboxSessions } from "../infrastructure/driver-instance/live-driver-instance.repository";
import { getSessionRunSummariesByIds } from "../infrastructure/session-runs/session-run-store.repository";
import {
  appendOneRuntimeDiagnosticEventPerSession,
  toRuntimeDiagnosticBaseValue,
} from "./runtime-diagnostic-events";
import {
  RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
  RUNTIME_STATE_OPERATION_TIMEOUT_ERROR,
} from "./runtime-state-operation-errors";
import { createRuntimeOperationSessionEvent } from "./runtime-state-operation-events";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";
import {
  adoptRuntimeOperationReadyReceipt,
  commitSessionLifecycleEventProjection,
  listRuntimeOperationTargets,
  transitionRuntimeTargetSessionStatus,
} from "./runtime-state-operation-target-store";
import type { RuntimeSessionTarget } from "./runtime-state-operation-target-store";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";
import { recordCanonicalSessionRunTerminal } from "./session-runs/session-run-terminal-failure.service";
import { createSessionLifecycleTerminatedEvent } from "./session-runs/session-run-view-events.service";

function listTargetRunIds(targets: readonly RuntimeSessionTarget[]): SessionRunId[] {
  return [...new Set(targets.flatMap((target) => (target.lastRunId ? [target.lastRunId] : [])))];
}

function runtimeOperationSessionEventId(input: {
  readonly kind: "interrupted" | "timed_out";
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
}): string {
  return `runtime-operation:${input.operationId}:${input.sessionId}:${input.kind}`;
}

async function getTargetRuns(
  database: D1Database,
  targets: readonly RuntimeSessionTarget[],
): Promise<Map<SessionRunId, SessionRunSummary>> {
  const runIds = listTargetRunIds(targets);

  if (runIds.length === 0) {
    return new Map();
  }

  return getSessionRunSummariesByIds(database, runIds);
}

function isTerminalRun(run: SessionRunSummary): boolean {
  return ["cancelled", "completed", "expired", "failed"].includes(run.status);
}

async function throwFirstFailure(
  outcomes: readonly PromiseSettledResult<unknown>[],
): Promise<void> {
  const failed = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );

  if (failed !== undefined) {
    throw failed.reason;
  }
}

async function adoptCanonicalTerminalRuns(
  database: D1Database,
  targets: readonly {
    readonly run: SessionRunSummary;
    readonly sessionId: SessionId;
  }[],
): Promise<ReadonlyMap<SessionRunId, TerminalEventSemanticAuthority>> {
  const outcomes = await Promise.allSettled(
    targets.map(async ({ run, sessionId }) => {
      const outcome = await adoptTerminalRunProjection(database, {
        runId: run.id,
        sessionId,
      });
      if (outcome.kind === "missing" || outcome.kind === "stale") {
        throw new Error(
          `Runtime operation found an incomplete terminal projection for run ${run.id}.`,
        );
      }
    }),
  );
  await throwFirstFailure(outcomes);

  if (targets.length === 0) {
    return new Map();
  }
  const rows = await getAppDatabase(database)
    .select({
      eventType: sessionEventsTable.eventType,
      runId: sessionEventsTable.runId,
      semanticHash: sessionEventsTable.semanticHash,
      sessionId: sessionEventsTable.sessionId,
      sourceEventId: sessionEventsTable.sourceEventId,
      streamId: sessionEventsTable.streamId,
      terminalEventJson: sessionEventsTable.terminalEventJson,
    })
    .from(sessionEventsTable)
    .where(
      and(
        inArray(
          sessionEventsTable.runId,
          targets.map(({ run }) => run.id),
        ),
        inArray(sessionEventsTable.eventType, ["run.cancelled", "run.completed", "run.failed"]),
      ),
    )
    .all();
  const rowsByRunId = Map.groupBy(
    rows.filter((row) => row.runId !== null),
    (row) => row.runId!,
  );
  const authorities = new Map<SessionRunId, TerminalEventSemanticAuthority>();
  for (const { run, sessionId } of targets) {
    const receipts = rowsByRunId.get(run.id) ?? [];
    const [receipt] = receipts;
    if (receipts.length !== 1 || receipt === undefined || receipt.semanticHash === null) {
      throw new Error(`Runtime operation found no v3 lifecycle authority for run ${run.id}.`);
    }
    authorities.set(
      run.id,
      await readTerminalEventSemanticAuthority({
        eventJson: receipt.terminalEventJson,
        eventType: receipt.eventType,
        runId: run.id,
        semanticHash: receipt.semanticHash,
        sessionId,
        sourceEventId: receipt.sourceEventId,
        streamId: receipt.streamId,
      }),
    );
  }
  return authorities;
}

export async function commitRuntimeOperationReadySnapshots(
  bindings: ApiBindings,
  input: {
    readonly event: RuntimeOperationEvent;
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  if (input.event.status !== "ready") {
    throw new Error("Runtime operation release requires one ready event.");
  }
  const timestampMs = Date.parse(input.event.observedAt);
  if (!Number.isFinite(timestampMs)) {
    throw new Error("Runtime operation ready time must be a valid ISO timestamp.");
  }

  const outcomes = await Promise.allSettled(
    input.targets.map(async (target) => {
      const event = createRuntimeOperationSessionEvent({
        event: input.event,
        operationId: input.operationId,
        sessionId: target.sessionId,
      });
      const outcome = await commitSessionLifecycleEventProjection(bindings.DB, {
        event,
        runtimeOperation: { operationId: input.operationId, status: "ready" },
        status: "IDLE",
        target,
        timestampMs,
      });

      return outcome.kind === "stale" ? null : { event, sessionId: target.sessionId };
    }),
  );
  await throwFirstFailure(outcomes);
  const committed = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : [],
  );
  const deliveries = await Promise.allSettled(
    committed.map(({ event, sessionId }) =>
      publishPersistedSessionRuntimeEvents({ bindings, events: [event], sessionId }),
    ),
  );
  await throwFirstFailure(deliveries);
}

export async function publishRuntimeOperationEvent(
  bindings: ApiBindings,
  input: {
    readonly event: RuntimeOperationEvent;
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  const outcomes = await Promise.allSettled(
    input.targets.map((target) =>
      publishPersistedSessionRuntimeEvents({
        bindings,
        events: [
          createRuntimeOperationSessionEvent({
            event: input.event,
            operationId: input.operationId,
            sessionId: target.sessionId,
          }),
        ],
        sessionId: target.sessionId,
      }),
    ),
  );
  await throwFirstFailure(outcomes);
}

export async function writeRuntimeOperationInterruptedSnapshots(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly timestampMs: number;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  const runsById = await getTargetRuns(bindings.DB, input.targets);
  const outcomes = await Promise.allSettled(
    input.targets.flatMap((target) => {
      const run = target.lastRunId === null ? null : (runsById.get(target.lastRunId) ?? null);

      return run === null || isTerminalRun(run)
        ? []
        : [
            recordCanonicalSessionRunTerminal(bindings, {
              assistantMessage: null,
              error: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
              expectedSessionOperationId: input.operationId,
              lifecycle: "IDLE",
              runId: run.id,
              sessionId: target.sessionId,
              source: "runtime_operation",
              status: "cancelled",
              timestampMs: input.timestampMs,
            }),
          ];
    }),
  );
  await throwFirstFailure(outcomes);

  const latestRuns = await getTargetRuns(bindings.DB, input.targets);
  const terminalRuns = input.targets.flatMap((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);

    if (run === null) {
      return [];
    }
    if (!isTerminalRun(run)) {
      throw new Error(`Runtime operation did not terminalize active run ${run.id}.`);
    }
    return [{ run, sessionId: target.sessionId }];
  });
  const terminalAuthorities = await adoptCanonicalTerminalRuns(bindings.DB, terminalRuns);
  const terminatedTargets = input.targets.filter((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);
    return run !== null && terminalAuthorities.get(run.id)?.lifecycle === "TERMINATED";
  });
  const currentTerminatedTargets = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: terminatedTargets,
  });
  const lifecycleOutcomes = await Promise.allSettled(
    currentTerminatedTargets.map(async (target) => {
      const ready = await adoptRuntimeOperationReadyReceipt(bindings.DB, {
        operationId: input.operationId,
        target,
      });
      if (ready !== "missing") {
        return null;
      }
      if (target.sessionUpdatedAt > input.timestampMs) {
        throw new Error("Runtime operation target advanced beyond its interruption time.");
      }
      const event = createSessionLifecycleTerminatedEvent({
        eventId: createPlatformId(),
        sourceEventId: runtimeOperationSessionEventId({
          kind: "interrupted",
          operationId: input.operationId,
          sessionId: target.sessionId,
        }),
        lastSeen: new Date(input.timestampMs).toISOString(),
        message: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR.message,
        occurredAtMs: input.timestampMs,
        reason: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR.code,
        sessionId: target.sessionId,
      });
      const outcome = await commitSessionLifecycleEventProjection(bindings.DB, {
        event,
        status: "TERMINATED",
        target,
        timestampMs: input.timestampMs,
      });
      return outcome.kind === "stale" ? null : { event, sessionId: target.sessionId };
    }),
  );
  await throwFirstFailure(lifecycleOutcomes);
  const lifecycleDeliveries = await Promise.allSettled(
    lifecycleOutcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" && outcome.value !== null
        ? [
            publishPersistedSessionRuntimeEvents({
              bindings,
              events: [outcome.value.event],
              sessionId: outcome.value.sessionId,
            }),
          ]
        : [],
    ),
  );
  await throwFirstFailure(lifecycleDeliveries);
  const unreleased = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: terminatedTargets,
  });
  if (unreleased.length > 0) {
    throw new Error("Runtime operation interruption did not preserve terminal Session lifecycle.");
  }
}

export async function appendRuntimeDriverRestartAttemptedEvents(
  bindings: ApiBindings,
  input: {
    targets: readonly RuntimeSessionTarget[];
    targetVersion: RuntimeOperationTargetVersion | null;
  },
): Promise<void> {
  const driverRefs = await listLiveDriverInstanceRefsForSandboxSessions(
    bindings.DB,
    input.targets.map((target) => target.sessionId),
  );
  const driverIdsBySessionId = new Map<SessionId, typeof driverRefs>();

  for (const driver of driverRefs) {
    const drivers = driverIdsBySessionId.get(driver.sandboxSessionId) ?? [];
    drivers.push(driver);
    driverIdsBySessionId.set(driver.sandboxSessionId, drivers);
  }

  const events = input.targets
    .flatMap((target) => {
      if (!isTruthy(target.agentId)) {
        return [];
      }

      const agentId = target.agentId;
      const driverIds = driverIdsBySessionId.get(target.sessionId) ?? [];
      if (driverIds.length === 0) {
        return [];
      }

      return driverIds.map((driver) => ({
        eventName: RUNTIME_DIAGNOSTIC_EVENT.driverRestartAttempted.name,
        sessionId: target.sessionId,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId,
            deploymentVersion: input.targetVersion,
            sessionId: target.sessionId,
          }),
          attemptNo: 1,
          driverInstanceId: driver.id,
        },
      }));
    })
    .filter(isTruthy);

  await appendOneRuntimeDiagnosticEventPerSession(bindings, {
    events,
  });
}

export async function appendRuntimeSubjectTerminatedEvents(
  bindings: ApiBindings,
  input: {
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly targets: readonly RuntimeDiagnosticSessionTarget[];
  },
): Promise<void> {
  await appendOneRuntimeDiagnosticEventPerSession(bindings, {
    events: input.targets.flatMap((target) => {
      if (!isTruthy(target.agentId)) {
        return [];
      }

      return [
        {
          eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxTerminated.name,
          sessionId: target.sessionId,
          value: {
            ...toRuntimeDiagnosticBaseValue({
              agentId: target.agentId,
              sessionId: target.sessionId,
            }),
            reason: input.reason,
            sandboxId: input.runtimeSubjectId,
          },
        },
      ];
    }),
  });
}

interface RuntimeDiagnosticSessionTarget {
  readonly agentId: AgentId | null;
  readonly sessionId: SessionId;
}

export async function writeRuntimeOperationTimedOutSnapshots(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  await writeRuntimeOperationTimedOutSnapshotsOnce(
    bindings,
    input,
    new Map(
      input.targets.map((target) => [
        target.sessionId,
        target.sessionUpdatedAt + RESCHEDULING_RECONNECT_WINDOW_MS,
      ]),
    ),
    true,
  );
}

async function writeRuntimeOperationTimedOutSnapshotsOnce(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
  deadlines: ReadonlyMap<SessionId, number>,
  retryStaleTargets: boolean,
): Promise<void> {
  const deadlineFor = (target: RuntimeSessionTarget): number => {
    const deadline = deadlines.get(target.sessionId);
    if (deadline === undefined) {
      throw new Error("Runtime operation timeout lost its stable target deadline.");
    }
    return deadline;
  };
  const runsById = await getTargetRuns(bindings.DB, input.targets);
  const activeTargets = input.targets.filter((target) => {
    const run = target.lastRunId === null ? null : (runsById.get(target.lastRunId) ?? null);
    return run !== null && !isTerminalRun(run);
  });
  const outcomes = await Promise.allSettled(
    activeTargets.map((target) => {
      const run = runsById.get(target.lastRunId!);
      if (run === undefined) {
        throw new Error("Runtime operation timeout lost its active run snapshot.");
      }

      return recordCanonicalSessionRunTerminal(bindings, {
        assistantMessage: null,
        error: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR,
        expectedSessionOperationId: input.operationId,
        lifecycle: "TERMINATED",
        runId: run.id,
        sessionId: target.sessionId,
        source: "runtime_operation",
        status: "expired",
        timestampMs: deadlineFor(target),
      });
    }),
  );
  await throwFirstFailure(outcomes);

  const latestRuns = await getTargetRuns(bindings.DB, input.targets);
  const terminalRuns = input.targets.flatMap((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);
    if (run === null) {
      return [];
    }
    if (!isTerminalRun(run)) {
      throw new Error(`Runtime operation timeout did not terminalize active run ${run.id}.`);
    }
    return [{ run, sessionId: target.sessionId }];
  });
  const terminalAuthorities = await adoptCanonicalTerminalRuns(bindings.DB, terminalRuns);

  const noRunLifecycleTargets = input.targets.filter((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);
    return run === null;
  });
  const terminatedTargets = input.targets.filter((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);
    return run !== null && terminalAuthorities.get(run.id)?.lifecycle === "TERMINATED";
  });
  const currentTerminatedTargets = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: terminatedTargets,
  });
  const originalTargetsById = new Map(input.targets.map((target) => [target.sessionId, target]));
  const lifecycleTargets = [
    ...noRunLifecycleTargets.map((target) => {
      const timestampMs = deadlineFor(target);
      if (target.sessionUpdatedAt > timestampMs) {
        throw new Error("Runtime operation target advanced beyond its stable timeout deadline.");
      }
      return { target, timestampMs };
    }),
    ...currentTerminatedTargets.map((target) => {
      const original = originalTargetsById.get(target.sessionId);
      if (original === undefined) {
        throw new Error("Runtime operation timeout lost its original target.");
      }
      const timestampMs = deadlineFor(original);
      if (target.sessionUpdatedAt > timestampMs) {
        throw new Error("Runtime operation target advanced beyond its stable timeout deadline.");
      }
      return { target, timestampMs };
    }),
  ];
  const lifecycleOutcomes = await Promise.allSettled(
    lifecycleTargets.map(async ({ target, timestampMs }) => {
      const ready = await adoptRuntimeOperationReadyReceipt(bindings.DB, {
        operationId: input.operationId,
        target,
      });
      if (ready !== "missing") {
        return null;
      }

      const event = createSessionLifecycleTerminatedEvent({
        eventId: createPlatformId(),
        sourceEventId: runtimeOperationSessionEventId({
          kind: "timed_out",
          operationId: input.operationId,
          sessionId: target.sessionId,
        }),
        lastSeen: new Date(timestampMs).toISOString(),
        message: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.message,
        occurredAtMs: timestampMs,
        reason: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.code,
        sessionId: target.sessionId,
      });
      const outcome = await commitSessionLifecycleEventProjection(bindings.DB, {
        event,
        status: "TERMINATED",
        target,
        timestampMs,
      });

      return outcome.kind === "stale" ? null : { event, sessionId: target.sessionId };
    }),
  );
  await throwFirstFailure(lifecycleOutcomes);
  const lifecycleDeliveries = await Promise.allSettled(
    lifecycleOutcomes.flatMap((outcome) =>
      outcome.status === "fulfilled" && outcome.value !== null
        ? [
            publishPersistedSessionRuntimeEvents({
              bindings,
              events: [outcome.value.event],
              sessionId: outcome.value.sessionId,
            }),
          ]
        : [],
    ),
  );
  await throwFirstFailure(lifecycleDeliveries);

  const adoptedTargets = input.targets.filter((target) => {
    const run = target.lastRunId === null ? null : (latestRuns.get(target.lastRunId) ?? null);
    return run !== null && terminalAuthorities.get(run.id)?.lifecycle === "IDLE";
  });
  const currentAdoptedTargets = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: adoptedTargets,
  });
  await transitionRuntimeTargetSessionStatus(bindings.DB, {
    expectedOperationId: input.operationId,
    operationId: null,
    status: "IDLE",
    targets: currentAdoptedTargets,
  });

  const unreleased = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: input.targets,
  });
  if (unreleased.length > 0) {
    if (retryStaleTargets) {
      await writeRuntimeOperationTimedOutSnapshotsOnce(
        bindings,
        { operationId: input.operationId, targets: unreleased },
        deadlines,
        false,
      );
      return;
    }
    throw new Error("Runtime operation timeout did not release every owned Session.");
  }
}
