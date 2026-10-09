import { sessionEventsTable, sessionsTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { createSessionRuntimeEvent } from "../../../sessions/application/session-event-write.service";
import {
  finalizeSessionModelCallUsage,
  upsertSessionModelCallUsage,
} from "../../../sessions/infrastructure/session-model-call.repository";
import { persistSessionRuntimeEvents } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import {
  discardUncommittedCompletionCheckpoint,
  prepareSessionRunCompletionCheckpoint,
} from "../session-runs/session-run-completion-checkpoint";
import {
  assertSessionRunTransition,
  isStaleTerminalRunTransition,
  setSessionRunStatus,
} from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import { persistAssistantMessageProjection } from "./assistant-message-projection";
import { compactRuntimeDriverRunTransitions } from "./event-projection";
import type { ProjectRuntimeDriverEventsResult, SessionLiveState } from "./event-types";
import { releaseTerminalDriverInstanceSessionRun } from "./terminal-run-release";

type DriverProjectedSessionRunStatusInput = Parameters<typeof setSessionRunStatus>[1];

async function setDriverProjectedSessionRunStatus(
  database: D1Database,
  input: DriverProjectedSessionRunStatusInput,
): Promise<SessionRunTransitionOutcome> {
  const outcome = await setSessionRunStatus(database, input);
  assertSessionRunTransition(outcome, "Driver event");
  return outcome;
}

function getRunDurationMs(outcome: SessionRunTransitionOutcome): number | null {
  if (
    outcome.kind !== "applied" ||
    outcome.run.startedAt === null ||
    outcome.run.completedAt === null
  ) {
    return null;
  }

  const durationMs = Date.parse(outcome.run.completedAt) - Date.parse(outcome.run.startedAt);
  return Number.isFinite(durationMs) ? Math.max(0, durationMs) : null;
}

async function autoTitleRuntimeSession(
  database: D1Database,
  link: ProjectRuntimeDriverEventsResult["link"],
  title: string,
): Promise<void> {
  if (link.creatorId === null) {
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
    projection: ProjectRuntimeDriverEventsResult;
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

  const shouldReleaseDriverRun = runTransition !== undefined && runTransition.status !== "running";
  let staleTerminalRunTransition = isStaleTerminalRunTransition(runTransitionOutcome);

  if (
    staleTerminalRunTransition &&
    !isStaleTerminalRunTransition(runTransitionOutcome, runTransition?.status)
  ) {
    if (shouldReleaseDriverRun && link.sessionRunId !== null) {
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

  if (projection.usage && link.sessionRunId !== null) {
    if (link.traceId === null) {
      throw new Error("Runtime session link is missing the session run trace id.");
    }

    await upsertSessionModelCallUsage(database, {
      driverInstanceId: input.driverInstanceId,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
      traceId: link.traceId,
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
  const finalAssistantRuntimeEvents: typeof terminalRuntimeEvents = [];
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
    const completionCheckpoint = await prepareSessionRunCompletionCheckpoint(bindings, link);
    runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
      ...(completionCheckpoint === undefined ? {} : { completionCheckpoint }),
      runId: link.sessionRunId,
      source: "driver",
      status: "completed",
    }).finally(() => discardUncommittedCompletionCheckpoint(bindings, completionCheckpoint));
    staleTerminalRunTransition = isStaleTerminalRunTransition(runTransitionOutcome);

    if (
      staleTerminalRunTransition &&
      !isStaleTerminalRunTransition(runTransitionOutcome, runTransition?.status)
    ) {
      if (shouldReleaseDriverRun) {
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

    const terminalRuntimeEvent = terminalRuntimeEvents[0];
    const finalSnapshotAlreadyPersisted =
      (await getAppDatabase(database)
        .select({ id: sessionEventsTable.id })
        .from(sessionEventsTable)
        .where(
          and(
            eq(sessionEventsTable.sessionId, link.sessionId),
            eq(sessionEventsTable.runId, link.sessionRunId),
            eq(sessionEventsTable.eventType, "message.added"),
            eq(sessionEventsTable.processType, "agent.message.delta"),
            eq(sessionEventsTable.contentText, projection.finalAssistantMessage.text),
          ),
        )
        .limit(1)
        .get()) !== undefined;

    if (terminalRuntimeEvent !== undefined && !finalSnapshotAlreadyPersisted) {
      const sourceEventId = `session-run:${link.sessionRunId}:final-assistant`;
      finalAssistantRuntimeEvents.push({
        event: createSessionRuntimeEvent({
          actor: terminalRuntimeEvent.event.actor,
          kind: "message.added",
          ...(terminalRuntimeEvent.occurredAt === null
            ? {}
            : { occurredAtMs: terminalRuntimeEvent.occurredAt }),
          origin: terminalRuntimeEvent.event.origin,
          payload: {
            content: projection.finalAssistantMessage.text,
            messageId: projection.finalAssistantMessage.id,
            role: "agent",
          },
          runId: link.sessionRunId,
          sessionId: link.sessionId,
          sourceEventId,
          traceId: terminalRuntimeEvent.event.traceId ?? link.traceId,
          visibility: terminalRuntimeEvent.event.visibility,
        }),
        occurredAt: terminalRuntimeEvent.occurredAt,
        sourceEventId,
      });
    }
  }

  if (shouldReleaseDriverRun && link.sessionRunId !== null) {
    await finalizeSessionModelCallUsage(database, link.sessionRunId);
  }

  const persistedTerminalEvents = await persistSessionRuntimeEvents(database, {
    records: [...finalAssistantRuntimeEvents, ...terminalRuntimeEvents],
    sessionId: link.sessionId,
  });
  persistedSourceEventIds.push(...persistedTerminalEvents.persistedSourceEventIds);

  const committedLiveState = projection.liveStateChanged ? nextLiveState : null;

  if (
    runTransition === undefined &&
    !staleTerminalRunTransition &&
    link.sessionRunId !== null &&
    projection.liveStateChanged &&
    nextLiveState.run.id === link.sessionRunId &&
    nextLiveState.run.status === "waiting_input"
  ) {
    await setDriverProjectedSessionRunStatus(database, {
      runId: link.sessionRunId,
      source: "driver",
      status: "waiting_input",
    });
  }

  if (
    completedTransition !== undefined &&
    runTransitionOutcome?.kind === "applied" &&
    link.executionOwnerId !== null
  ) {
    const runDurationMs = getRunDurationMs(runTransitionOutcome);

    await captureServerProductEvent(bindings, {
      distinctId: link.executionOwnerId,
      event: SERVER_PRODUCT_ANALYTICS_EVENTS.taskSucceeded,
      properties: {
        agent_id: link.agentId,
        project_id: link.projectId,
        run_id: link.sessionRunId,
        run_duration_ms: runDurationMs,
        sandbox_id: link.sandboxId,
        sandbox_subject_kind: link.sandboxSubjectKind,
        session_id: link.sessionId,
        session_type: link.sessionType,
      },
    });
  }

  if (shouldReleaseDriverRun && link.sessionRunId !== null) {
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
