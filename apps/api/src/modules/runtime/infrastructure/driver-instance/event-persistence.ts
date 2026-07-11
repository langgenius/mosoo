import { sessionsTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { upsertSessionModelCallUsage } from "../../../sessions/application/session-model-call.service";
import { persistSessionRuntimeEvents } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { setSessionRunStatus } from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import { persistAssistantMessageProjection } from "./assistant-message-projection";
import { compactRuntimeDriverRunTransitions } from "./event-projection";
import type {
  AppRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
  SessionLiveState,
} from "./event-types";
import { hasTerminalRuntimeDriverRunTransition } from "./run-transitions";

async function loadTerminalRunRelease() {
  return import("./terminal-run-release");
}

function getModelCallStatus(
  transitions: ReturnType<typeof compactRuntimeDriverRunTransitions>,
): "completed" | "failed" | "started" {
  for (const transition of transitions) {
    if (transition.status === "completed") {
      return "completed";
    }

    if (transition.status === "cancelled" || transition.status === "failed") {
      return "failed";
    }
  }

  return "started";
}

type DriverProjectedSessionRunStatusInput = Parameters<typeof setSessionRunStatus>[1];

function assertDriverProjectedSessionRunTransition(outcome: SessionRunTransitionOutcome): void {
  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return;
    }
    case "stale": {
      if (outcome.reason === "terminal_run") {
        return;
      }
      throw new Error("Driver run transition lost a concurrent status race.");
    }
    case "repair_needed": {
      throw new Error("Driver run transition left the session lifecycle projection stale.");
    }
    case "rejected": {
      throw new Error(`Driver run transition was rejected: ${outcome.reason}.`);
    }
  }
}

async function setDriverProjectedSessionRunStatus(
  database: D1Database,
  input: DriverProjectedSessionRunStatusInput,
): Promise<SessionRunTransitionOutcome> {
  const outcome = await setSessionRunStatus(database, input);
  assertDriverProjectedSessionRunTransition(outcome);
  return outcome;
}

function isStaleTerminalRunTransition(outcome: SessionRunTransitionOutcome | null): boolean {
  return outcome?.kind === "stale" && outcome.reason === "terminal_run";
}

function isMatchingStaleTerminalRunTransition(input: {
  readonly outcome: SessionRunTransitionOutcome | null;
  readonly transition: RuntimeDriverRunTransition | undefined;
}): boolean {
  if (input.outcome?.kind !== "stale" || input.outcome.reason !== "terminal_run") {
    return true;
  }

  return input.transition !== undefined && input.outcome.currentStatus === input.transition.status;
}

async function autoTitleRuntimeSession(
  database: D1Database,
  link: RuntimeSessionLink,
  title: string,
): Promise<void> {
  if (link.creatorId === null || link.sessionId === null) {
    return;
  }

  await getAppDatabase(database)
    .update(sessionsTable)
    .set({
      title,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(sessionsTable.id, link.sessionId),
        eq(sessionsTable.creatorAccountId, link.creatorId),
        isNull(sessionsTable.title),
        eq(sessionsTable.renamed, false),
      ),
    )
    .run();
}

export interface PersistProjectedRuntimeDriverEventsResult {
  liveState: SessionLiveState | null;
  persistedSourceEventIds: readonly string[];
}

export async function persistProjectedRuntimeDriverEvents(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    projection: AppRuntimeDriverEventsResult;
  },
): Promise<PersistProjectedRuntimeDriverEventsResult> {
  const database = bindings.DB;
  const { link, nextLiveState, projection } = {
    link: input.projection.link,
    nextLiveState: input.projection.nextLiveState,
    projection: input.projection,
  };
  const transitions = compactRuntimeDriverRunTransitions(projection.transitions);
  const [runTransition] = transitions;
  const deferCompletedRunTransition = runTransition?.status === "completed";
  let runTransitionOutcome: SessionRunTransitionOutcome | null = null;

  if (link.sessionId === null) {
    return {
      liveState: null,
      persistedSourceEventIds: [],
    };
  }

  if (runTransition !== undefined && link.sessionRunId !== null && !deferCompletedRunTransition) {
    if (runTransition.status === "running") {
      runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
        runId: link.sessionRunId,
        source: "driver",
        status: "running",
      });
    } else if (runTransition.status === "cancelled") {
      runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
        runId: link.sessionRunId,
        source: "driver",
        status: "cancelled",
      });
    } else {
      runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
        error: runTransition.error ?? null,
        runId: link.sessionRunId,
        source: "driver",
        status: "failed",
      });
    }
  }

  const shouldReleaseDriverRun = hasTerminalRuntimeDriverRunTransition(transitions);
  let staleTerminalRunTransition = isStaleTerminalRunTransition(runTransitionOutcome);

  if (
    staleTerminalRunTransition &&
    !isMatchingStaleTerminalRunTransition({
      outcome: runTransitionOutcome,
      transition: runTransition,
    })
  ) {
    if (shouldReleaseDriverRun && link.sessionRunId !== null) {
      const { releaseTerminalDriverInstanceSessionRun } = await loadTerminalRunRelease();
      await releaseTerminalDriverInstanceSessionRun(bindings, {
        driverInstanceId: input.driverInstanceId,
        sessionRunId: link.sessionRunId,
      });
    }

    return {
      liveState: null,
      persistedSourceEventIds: [],
    };
  }

  if (projection.sessionTitle !== null && projection.sessionTitle.length > 0) {
    await autoTitleRuntimeSession(database, link, projection.sessionTitle);
  }

  const traceId = link.traceId ?? link.sessionRunId ?? link.sessionId;

  if (projection.usage && link.sessionRunId !== null) {
    await upsertSessionModelCallUsage(database, {
      driverInstanceId: input.driverInstanceId,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
      status: getModelCallStatus(transitions),
      traceId,
      usage: projection.usage,
    });
  }

  const completedTransition = transitions.find((transition) => transition.status === "completed");
  const preCompletionRuntimeEvents =
    completedTransition === undefined
      ? []
      : projection.runtimeEvents.filter((record) => record.event.kind !== "run.completed");
  const terminalRuntimeEvents =
    completedTransition === undefined
      ? projection.runtimeEvents
      : projection.runtimeEvents.filter((record) => record.event.kind === "run.completed");
  const persistedSourceEventIds: string[] = [];

  if (preCompletionRuntimeEvents.length > 0) {
    const persisted = await persistSessionRuntimeEvents(database, {
      records: preCompletionRuntimeEvents,
      sessionId: link.sessionId,
    });
    persistedSourceEventIds.push(...persisted.persistedSourceEventIds);
  }

  // Completion is a retry boundary. Arbitrate the terminal Run status before
  // writing canonical output, so a concurrent failure/cancellation cannot
  // leave a final assistant row on a non-completed Run. The terminal receipt
  // remains last: a crash after the CAS is repaired by replay against the exact
  // completed Run link.
  if (deferCompletedRunTransition && link.sessionRunId !== null) {
    runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
      runId: link.sessionRunId,
      source: "driver",
      status: "completed",
    });
    staleTerminalRunTransition = isStaleTerminalRunTransition(runTransitionOutcome);

    if (
      staleTerminalRunTransition &&
      !isMatchingStaleTerminalRunTransition({
        outcome: runTransitionOutcome,
        transition: runTransition,
      })
    ) {
      if (shouldReleaseDriverRun) {
        const { releaseTerminalDriverInstanceSessionRun } = await loadTerminalRunRelease();
        await releaseTerminalDriverInstanceSessionRun(bindings, {
          driverInstanceId: input.driverInstanceId,
          sessionRunId: link.sessionRunId,
        });
      }

      return {
        liveState: null,
        persistedSourceEventIds: [],
      };
    }
  }

  if (
    completedTransition !== undefined &&
    projection.finalAssistantMessage !== null &&
    nextLiveState !== null &&
    link.sessionRunId !== null &&
    nextLiveState.run.id === link.sessionRunId
  ) {
    await persistAssistantMessageProjection(database, {
      createdByAccountId: link.callerId ?? link.creatorId ?? input.driverInstanceId,
      driverInstanceId: input.driverInstanceId,
      messageId: projection.finalAssistantMessage.id,
      messageText: projection.finalAssistantMessage.text,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
      state: nextLiveState,
    });
  }

  const persistedTerminalEvents = await persistSessionRuntimeEvents(database, {
    records: terminalRuntimeEvents,
    sessionId: link.sessionId,
  });
  persistedSourceEventIds.push(...persistedTerminalEvents.persistedSourceEventIds);

  let committedLiveState: SessionLiveState | null = null;

  if (projection.liveStateChanged && nextLiveState !== null) {
    committedLiveState = nextLiveState;
  }

  if (
    runTransition === undefined &&
    !staleTerminalRunTransition &&
    link.sessionRunId !== null &&
    projection.liveStateChanged &&
    nextLiveState !== null &&
    nextLiveState.run.id === link.sessionRunId &&
    nextLiveState.run.status === "waiting_input"
  ) {
    await setDriverProjectedSessionRunStatus(database, {
      runId: link.sessionRunId,
      source: "driver",
      status: "waiting_input",
    });
  }

  if (shouldReleaseDriverRun && link.sessionRunId !== null) {
    const { releaseTerminalDriverInstanceSessionRun } = await loadTerminalRunRelease();
    await releaseTerminalDriverInstanceSessionRun(bindings, {
      driverInstanceId: input.driverInstanceId,
      sessionRunId: link.sessionRunId,
    });
  }

  return {
    liveState: committedLiveState,
    persistedSourceEventIds,
  };
}
