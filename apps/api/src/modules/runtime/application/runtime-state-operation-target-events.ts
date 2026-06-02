import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, RuntimeOperationId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import {
  appendOneSessionRuntimeEventPerSession,
  createSessionRuntimeEvent,
} from "../../sessions/application/session-event-write.service";
import { listLiveDriverInstanceRefsForSandboxSessions } from "../infrastructure/driver-instance/live-driver-instance.repository";
import {
  cancelActiveSessionRunsForRuntimeOperation,
  getSessionRunSummariesByIds,
} from "../infrastructure/session-runs/session-run-store.repository";
import {
  appendOneRuntimeDiagnosticEventPerSession,
  toRuntimeDiagnosticBaseValue,
} from "./runtime-diagnostic-events";
import {
  RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
  RUNTIME_STATE_OPERATION_TIMEOUT_ERROR,
} from "./runtime-state-operation-errors";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";
import type { RuntimeSessionTarget } from "./runtime-state-operation-target-store";
import type { RuntimeOperationTargetVersion } from "./runtime-state-operation-version";
import {
  createCancelledSessionRunRuntimeEvent,
  createSessionLifecycleTerminatedEvent,
} from "./session-runs/session-run-view-events.service";

function listTargetRunIds(targets: readonly RuntimeSessionTarget[]): SessionRunId[] {
  const runIds: SessionRunId[] = [];

  for (const target of targets) {
    if (target.sessionStatus !== "IDLE" && isTruthy(target.lastRunId)) {
      runIds.push(target.lastRunId);
    }
  }

  return runIds;
}

function toObservedAtMs(value: string): number | undefined {
  const observedAtMs = Date.parse(value);

  return Number.isFinite(observedAtMs) ? observedAtMs : undefined;
}

function runtimeOperationRunEventId(input: {
  readonly kind: "interrupted" | "timed_out";
  readonly operationId: RuntimeOperationId;
  readonly runId: SessionRunId;
}): string {
  return `runtime-operation:${input.operationId}:${input.runId}:${input.kind}`;
}

function runtimeOperationSessionEventId(input: {
  readonly kind: "timed_out";
  readonly operationId: RuntimeOperationId;
  readonly sessionId: SessionId;
}): string {
  return `runtime-operation:${input.operationId}:${input.sessionId}:${input.kind}`;
}

async function cancelRuntimeOperationTargetRuns(
  bindings: ApiBindings,
  input: {
    readonly error: RunError;
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<Map<SessionRunId, SessionRunSummary>> {
  const runIds = listTargetRunIds(input.targets);

  if (runIds.length === 0) {
    return new Map();
  }

  const updated = await cancelActiveSessionRunsForRuntimeOperation(bindings.DB, {
    error: input.error,
    operationId: input.operationId,
    runIds,
  });

  return getSessionRunSummariesByIds(bindings.DB, [...updated.runIds]);
}

export async function broadcastRuntimeOperationEvent(
  bindings: ApiBindings,
  input: {
    readonly event: RuntimeOperationEvent;
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  await appendOneSessionRuntimeEventPerSession({
    bindings,
    records: input.targets.map((target) => {
      const occurredAtMs = toObservedAtMs(input.event.observedAt);

      return {
        event: createSessionRuntimeEvent({
          kind: "agent.task.updated",
          ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
          payload: {
            agentId: input.event.agentId,
            ...(input.event.deploymentVersionId
              ? {
                  deploymentVersionId: input.event.deploymentVersionId,
                  deploymentVersionNumber: input.event.deploymentVersionNumber,
                }
              : {}),
            operation: input.event.operation,
            operationId: input.operationId,
            ...(input.event.status === "ready"
              ? { readyAt: input.event.observedAt }
              : { startedAt: input.event.observedAt }),
            status: input.event.status,
          },
          sessionId: target.sessionId,
        }),
        sessionId: target.sessionId,
      };
    }),
  });
}

export async function writeRuntimeOperationInterruptedSnapshots(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<void> {
  const runsById = await cancelRuntimeOperationTargetRuns(bindings, {
    error: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
    operationId: input.operationId,
    targets: input.targets,
  });

  const records = input.targets
    .map((target) => {
      if (!isTruthy(target.lastRunId) || target.sessionStatus === "IDLE") {
        return null;
      }

      const run = runsById.get(target.lastRunId);

      if (!run) {
        return null;
      }

      return {
        event: createCancelledSessionRunRuntimeEvent({
          eventId: createPlatformId(),
          sourceEventId: runtimeOperationRunEventId({
            kind: "interrupted",
            operationId: input.operationId,
            runId: target.lastRunId,
          }),
          run,
          runError: RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR,
          sessionId: target.sessionId,
        }),
        sessionId: target.sessionId,
      };
    })
    .filter(isTruthy);

  await appendOneSessionRuntimeEventPerSession({
    bindings,
    records,
  });
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
  const runsById = await cancelRuntimeOperationTargetRuns(bindings, {
    error: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR,
    operationId: input.operationId,
    targets: input.targets,
  });

  const records = input.targets
    .map((target) => {
      if (!isTruthy(target.lastRunId) || target.sessionStatus === "IDLE") {
        return {
          event: createSessionLifecycleTerminatedEvent({
            eventId: createPlatformId(),
            sourceEventId: runtimeOperationSessionEventId({
              kind: "timed_out",
              operationId: input.operationId,
              sessionId: target.sessionId,
            }),
            lastSeen: new Date().toISOString(),
            message: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.message,
            reason: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.code,
            sessionId: target.sessionId,
          }),
          sessionId: target.sessionId,
        };
      }

      const run = runsById.get(target.lastRunId);

      if (!run) {
        return {
          event: createSessionLifecycleTerminatedEvent({
            eventId: createPlatformId(),
            sourceEventId: runtimeOperationSessionEventId({
              kind: "timed_out",
              operationId: input.operationId,
              sessionId: target.sessionId,
            }),
            lastSeen: new Date().toISOString(),
            message: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.message,
            reason: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR.code,
            sessionId: target.sessionId,
          }),
          sessionId: target.sessionId,
        };
      }

      return {
        event: createCancelledSessionRunRuntimeEvent({
          eventId: createPlatformId(),
          sourceEventId: runtimeOperationRunEventId({
            kind: "timed_out",
            operationId: input.operationId,
            runId: target.lastRunId,
          }),
          lifecycle: "TERMINATED",
          run,
          runError: RUNTIME_STATE_OPERATION_TIMEOUT_ERROR,
          sessionId: target.sessionId,
        }),
        sessionId: target.sessionId,
      };
    })
    .filter(isTruthy);

  await appendOneSessionRuntimeEventPerSession({
    bindings,
    records,
  });
}
