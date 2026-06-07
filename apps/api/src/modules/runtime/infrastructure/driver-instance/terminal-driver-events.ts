import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import type { DriverFailureInput } from "agent-driver/orpc";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import {
  applyRuntimeEventToSessionLiveState,
  loadSessionViewerState,
  projectRuntimeEventToSessionDeliveryEvents,
} from "../../../sessions/application/session-live-state.service";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
import { recordRuntimeRunLeaseReleasedOutcome } from "../runtime-subject-lifecycle/runtime-run-lease-store";
import { setSessionRunStatus } from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import { persistAssistantMessageProjection } from "./assistant-message-projection";
import type { RuntimeSessionLink } from "./event-types";
import { getRuntimeSessionLink } from "./session-link.repository";
import {
  closeTerminalRuntimeConversationIfNeeded,
  recycleReleasedTerminalRuntimeLeaseIfNeeded,
} from "./terminal-runtime-lease";
import { syncLocalSandboxSpaceFilesAfterTurn } from "./terminal-space-sync";

function assertTerminalDriverSessionRunTransition(outcome: SessionRunTransitionOutcome): void {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return;
    }
    case "stale": {
      if (outcome.reason === "terminal_run") {
        return;
      }
      throw new Error("Terminal driver event lost a concurrent run transition.");
    }
    case "repair_needed": {
      throw new Error("Terminal driver event left the session lifecycle projection stale.");
    }
    case "rejected": {
      throw new Error(`Terminal driver event run transition was rejected: ${outcome.reason}.`);
    }
  }
}

function isStaleTerminalRunTransition(outcome: SessionRunTransitionOutcome): boolean {
  return outcome.kind === "stale" && outcome.reason === "terminal_run";
}

function isStaleTerminalRunStatus(
  outcome: SessionRunTransitionOutcome,
  status: "completed" | "failed",
): boolean {
  return (
    outcome.kind === "stale" &&
    outcome.reason === "terminal_run" &&
    outcome.currentStatus === status
  );
}

function createTerminalDriverEventId(input: {
  readonly driverInstanceId: DriverInstanceId;
  readonly kind: "run.completed" | "run.failed";
  readonly sessionRunId: SessionRunId;
}): string {
  return `driver-terminal:${input.driverInstanceId}:${input.sessionRunId}:${input.kind}`;
}

export async function recordDriverInstanceCompletion(
  bindings: ApiBindings,
  input: {
    driverReady: boolean;
    driverInstanceId: DriverInstanceId;
  },
): Promise<void> {
  void input.driverReady;
  const database = bindings.DB;
  const link = await getRuntimeSessionLink(database, input.driverInstanceId);

  if (
    hasLinkedSessionRun(link) &&
    link.sessionRunStatus !== null &&
    (!isTerminalSessionRunStatus(link.sessionRunStatus) || link.sessionRunStatus === "completed")
  ) {
    await synthesizeDriverRunFinished(database, {
      bindings,
      driverInstanceId: input.driverInstanceId,
      link,
    });
  }

  await syncLocalSandboxSpaceFilesAfterTurnSafely(bindings, link);
  const released = await releaseLinkedRunLease(bindings, {
    driverInstanceId: input.driverInstanceId,
    link,
    sessionRunId: link.sessionRunId,
  });
  await recycleReleasedTerminalRuntimeLeaseIfNeeded(bindings, { link, released });
}

export async function recordDriverInstanceFailure(
  bindings: ApiBindings,
  input: {
    error: DriverFailureInput["error"];
    driverInstanceId: DriverInstanceId;
  },
): Promise<void> {
  const database = bindings.DB;
  const link = await getRuntimeSessionLink(database, input.driverInstanceId);

  if (
    link.sessionRunId !== null &&
    link.sessionRunStatus !== null &&
    isTerminalSessionRunStatus(link.sessionRunStatus)
  ) {
    if (hasLinkedSessionRun(link) && link.sessionRunStatus === "failed") {
      await appendCanonicalTerminalDriverEvent({
        bindings,
        event: createDriverRunFailedEvent({
          driverInstanceId: input.driverInstanceId,
          error: input.error,
          link,
        }),
      });
    }

    const released = await releaseLinkedRunLease(bindings, {
      driverInstanceId: input.driverInstanceId,
      link,
      sessionRunId: link.sessionRunId,
    });
    await recycleReleasedTerminalRuntimeLeaseIfNeeded(bindings, { link, released });
    return;
  }

  if (link.sessionRunId !== null) {
    const failedEvent = hasLinkedSessionRun(link)
      ? createDriverRunFailedEvent({
          driverInstanceId: input.driverInstanceId,
          error: input.error,
          link,
        })
      : null;
    const outcome = await setSessionRunStatus(database, {
      error: input.error,
      runId: link.sessionRunId,
      source: "driver",
      status: "failed",
    });
    assertTerminalDriverSessionRunTransition(outcome);

    if (
      failedEvent !== null &&
      (!isStaleTerminalRunTransition(outcome) || isStaleTerminalRunStatus(outcome, "failed"))
    ) {
      await appendCanonicalTerminalDriverEvent({
        bindings,
        event: failedEvent,
      });
    }
  }

  await syncLocalSandboxSpaceFilesAfterTurnSafely(bindings, link);
  const released = await releaseLinkedRunLease(bindings, {
    driverInstanceId: input.driverInstanceId,
    link,
    sessionRunId: link.sessionRunId,
  });
  await recycleReleasedTerminalRuntimeLeaseIfNeeded(bindings, { link, released });
}

async function syncLocalSandboxSpaceFilesAfterTurnSafely(
  bindings: ApiBindings,
  link: RuntimeSessionLink,
): Promise<void> {
  try {
    await syncLocalSandboxSpaceFilesAfterTurn(bindings, link);
  } catch (error) {
    logWarn("runtime.terminal.space_sync.failed", {
      ...createErrorLogContext(error),
      sandboxId: link.sandboxId,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
    });
  }
}

async function synthesizeDriverRunFinished(
  database: D1Database,
  input: {
    bindings: ApiBindings;
    driverInstanceId: DriverInstanceId;
    link: RuntimeSessionLink & {
      sessionId: SessionId;
      sessionRunId: SessionRunId;
    };
  },
): Promise<void> {
  const eventId = createTerminalDriverEventId({
    driverInstanceId: input.driverInstanceId,
    kind: "run.completed",
    sessionRunId: input.link.sessionRunId,
  });
  const runCompletedEvent = createRuntimeEvent({
    driverInstanceId: input.driverInstanceId,
    id: createPlatformId<RuntimeEventId>(),
    kind: "run.completed",
    occurredAt: new Date().toISOString(),
    payload: {
      stopReason: "end_turn",
    },
    runId: input.link.sessionRunId,
    sessionId: input.link.sessionId,
    sourceEventId: eventId,
  });
  const [runFinishedEvent] = projectRuntimeEventToSessionDeliveryEvents(runCompletedEvent);

  if (runFinishedEvent === undefined) {
    throw new Error("Run completion event did not project to session delivery.");
  }

  const currentLiveState = await loadSessionViewerState(database, {
    sessionId: input.link.sessionId,
    viewerId: input.link.callerId ?? input.link.creatorId ?? input.driverInstanceId,
  });
  const nextLiveState = applyRuntimeEventToSessionLiveState(currentLiveState, runCompletedEvent);

  const outcome = await setSessionRunStatus(database, {
    runId: input.link.sessionRunId,
    source: "driver",
    status: "completed",
  });
  assertTerminalDriverSessionRunTransition(outcome);
  if (isStaleTerminalRunTransition(outcome) && !isStaleTerminalRunStatus(outcome, "completed")) {
    return;
  }
  await persistAssistantMessageProjection(database, {
    createdByAccountId: input.link.callerId ?? input.link.creatorId ?? input.driverInstanceId,
    driverInstanceId: input.driverInstanceId,
    sessionId: input.link.sessionId,
    sessionRunId: input.link.sessionRunId,
    state: nextLiveState,
  });
  await appendCanonicalTerminalDriverEvent({
    bindings: input.bindings,
    event: runCompletedEvent,
  });
}

function createDriverRunFailedEvent(input: {
  readonly driverInstanceId: DriverInstanceId;
  readonly error: DriverFailureInput["error"];
  readonly link: RuntimeSessionLink & {
    readonly sessionId: SessionId;
    readonly sessionRunId: SessionRunId;
  };
}): RuntimeEventEnvelope {
  const eventId = createTerminalDriverEventId({
    driverInstanceId: input.driverInstanceId,
    kind: "run.failed",
    sessionRunId: input.link.sessionRunId,
  });

  return createRuntimeEvent({
    driverInstanceId: input.driverInstanceId,
    id: createPlatformId<RuntimeEventId>(),
    kind: "run.failed",
    occurredAt: new Date().toISOString(),
    payload: {
      error: input.error,
      recoverable: false,
    },
    runId: input.link.sessionRunId,
    sessionId: input.link.sessionId,
    sourceEventId: eventId,
  });
}

async function appendCanonicalTerminalDriverEvent(input: {
  bindings: ApiBindings;
  event: RuntimeEventEnvelope;
}): Promise<void> {
  await appendSessionRuntimeEvents({
    bindings: input.bindings,
    events: [input.event],
    sessionId: input.event.sessionId,
    sourceEventId: input.event.sourceEventId ?? input.event.id,
  });
}

function hasLinkedSessionRun(link: RuntimeSessionLink): link is RuntimeSessionLink & {
  sessionId: SessionId;
  sessionRunId: SessionRunId;
} {
  return link.sessionId !== null && link.sessionRunId !== null;
}

async function releaseLinkedRunLease(
  bindings: ApiBindings,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly link: RuntimeSessionLink;
    readonly sessionRunId: SessionRunId | null;
  },
): Promise<boolean> {
  if (input.sessionRunId === null) {
    return false;
  }

  const outcome = await recordRuntimeRunLeaseReleasedOutcome(bindings.DB, {
    driverInstanceId: input.driverInstanceId,
    expectedSessionRunId: input.sessionRunId,
  });
  const released = outcome.status === "applied";

  if (!released) {
    logWarn("runtime.run.lease.release_skipped", {
      driverInstanceId: input.driverInstanceId,
      reason: "reason" in outcome ? outcome.reason : outcome.status,
      sessionRunId: input.sessionRunId,
      status: outcome.status,
    });
  }

  if (released) {
    await closeTerminalRuntimeConversationIfNeeded(bindings, input.link);
  }

  return released;
}
