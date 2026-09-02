import type { DriverInstanceId } from "@mosoo/id";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { reduceMessageStreamLifecycle } from "../../../sessions/domain/session-event-stream-fold";
import { createSessionRuntimeEventProjection } from "../../../sessions/domain/session-runtime-event-projection";
import {
  isSealedPublicSessionMessageStream,
  readPublicSessionMessageStreamSealState,
} from "../../../sessions/infrastructure/session-message-event-stream.repository";
import { persistSessionRuntimeEvents } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { prepareAssistantMessageProjection } from "./assistant-message-projection";
import type { PreparedAssistantMessageProjection } from "./assistant-message-projection";
import { commitTerminalRunProjection } from "./completed-run-commit.repository";
import type { DriverTerminalRunStatus } from "./completed-run-commit.repository";
import { compactRuntimeDriverRunTransitions } from "./event-projection";
import type {
  ProjectRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
  SessionLiveState,
} from "./event-types";

async function resolveFinalAssistantMessage(
  database: D1Database,
  input: {
    messageId: string;
    runId: NonNullable<RuntimeSessionLink["sessionRunId"]>;
    sessionId: NonNullable<RuntimeSessionLink["sessionId"]>;
  },
): Promise<{ id: string }> {
  const sealed = await isSealedPublicSessionMessageStream(database, {
    processType: "agent.message.delta",
    runId: input.runId,
    sessionId: input.sessionId,
    streamId: input.messageId,
  });

  if (!sealed) {
    throw new Error(
      `Completed run final message ${input.messageId} has no sealed authoritative snapshot.`,
    );
  }

  return { id: input.messageId };
}

async function isFinalAssistantMessageSealedAfterProjection(
  database: D1Database,
  input: {
    messageId: string;
    projection: ProjectRuntimeDriverEventsResult;
    runId: NonNullable<RuntimeSessionLink["sessionRunId"]>;
    sessionId: NonNullable<RuntimeSessionLink["sessionId"]>;
  },
): Promise<boolean> {
  let state = await readPublicSessionMessageStreamSealState(database, {
    processType: "agent.message.delta",
    runId: input.runId,
    sessionId: input.sessionId,
    streamId: input.messageId,
  });

  for (const { event } of input.projection.runtimeEvents) {
    if (
      event.kind !== "message.added" &&
      event.kind !== "message.cancelled" &&
      event.kind !== "message.completed" &&
      event.kind !== "message.delta" &&
      event.kind !== "message.failed" &&
      event.kind !== "message.started"
    ) {
      continue;
    }
    const row = createSessionRuntimeEventProjection(event);
    if (row.streamId !== input.messageId) {
      continue;
    }
    if (
      event.sessionId !== input.sessionId ||
      row.runId !== input.runId ||
      row.processType !== "agent.message.delta"
    ) {
      throw new Error(`Session message stream ${input.messageId} has conflicting identity rows.`);
    }
    if (row.visibility !== "all_consumers") {
      throw new Error(`Session message stream ${input.messageId} has mixed visibility.`);
    }

    state = reduceMessageStreamLifecycle(state, event.kind);
  }

  return state.sealed;
}

function isTerminalRunTransition(
  transition: RuntimeDriverRunTransition | undefined,
): transition is RuntimeDriverRunTransition & { status: DriverTerminalRunStatus } {
  return transition !== undefined && transition.status !== "running";
}

function terminalRuntimeEventKind(status: DriverTerminalRunStatus) {
  return `run.${status}` as const;
}

export interface PersistProjectedRuntimeDriverEventsResult {
  liveState: SessionLiveState | null;
  persistedSourceEventIds: readonly string[];
}

export async function preflightProjectedRuntimeDriverEvents(
  database: D1Database,
  projection: ProjectRuntimeDriverEventsResult,
): Promise<void> {
  const { link } = projection;
  if (link.sessionId === null) {
    return;
  }
  const [runTransition] = compactRuntimeDriverRunTransitions(projection.transitions);
  const terminalRunTransition = isTerminalRunTransition(runTransition) ? runTransition : undefined;

  if (terminalRunTransition !== undefined && link.sessionRunId === null) {
    throw new Error("Terminal run projection is missing its run scope.");
  }
  if (
    terminalRunTransition?.status === "completed" &&
    projection.finalAssistantMessageId !== null
  ) {
    if (link.sessionRunId === null) {
      throw new Error("Completed run final message is missing its run scope.");
    }
    if (
      !(await isFinalAssistantMessageSealedAfterProjection(database, {
        messageId: projection.finalAssistantMessageId,
        projection,
        runId: link.sessionRunId,
        sessionId: link.sessionId,
      }))
    ) {
      throw new Error(
        `Completed run final message ${projection.finalAssistantMessageId} has no sealed authoritative snapshot.`,
      );
    }
  }
  if (terminalRunTransition !== undefined) {
    const terminalKind = terminalRuntimeEventKind(terminalRunTransition.status);
    if (projection.runtimeEvents.filter(({ event }) => event.kind === terminalKind).length !== 1) {
      throw new Error("Terminal run projection requires exactly one terminal runtime event.");
    }
  }
}

export async function persistProjectedRuntimeDriverEventPrerequisites(
  database: D1Database,
  input: {
    driverConnectionId: string;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    projection: ProjectRuntimeDriverEventsResult;
  },
): Promise<void> {
  const { link, runtimeEvents } = input.projection;
  if (link.sessionId === null) {
    return;
  }
  const [runTransition] = compactRuntimeDriverRunTransitions(input.projection.transitions);
  const terminalRunTransition = isTerminalRunTransition(runTransition) ? runTransition : undefined;
  if (terminalRunTransition === undefined) {
    return;
  }
  const terminalKind = terminalRuntimeEventKind(terminalRunTransition.status);
  const prerequisites = runtimeEvents.filter(
    ({ event }) =>
      event.kind !== terminalKind &&
      event.kind !== "file.change.updated" &&
      event.kind !== "file.changed",
  );
  if (prerequisites.length === 0) {
    return;
  }
  await persistSessionRuntimeEvents(database, {
    driverFence: {
      connectionId: input.driverConnectionId,
      driverInstanceId: input.driverInstanceId,
      generation: input.driverGeneration,
      sessionRunId: link.sessionRunId,
    },
    records: prerequisites,
    sessionId: link.sessionId,
  });
}

export async function persistProjectedRuntimeDriverEvents(
  bindings: ApiBindings,
  input: {
    driverConnectionId: string;
    driverGeneration: number;
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
  const terminalRunTransition = isTerminalRunTransition(runTransition) ? runTransition : undefined;

  if (link.sessionId === null) {
    return {
      liveState: null,
      persistedSourceEventIds: [],
    };
  }
  const driverFence = {
    connectionId: input.driverConnectionId,
    driverInstanceId: input.driverInstanceId,
    generation: input.driverGeneration,
    sessionRunId: link.sessionRunId,
  };

  const completedTransition = terminalRunTransition?.status === "completed";
  const terminalEventKind =
    terminalRunTransition === undefined
      ? null
      : terminalRuntimeEventKind(terminalRunTransition.status);
  const preTerminalRuntimeEvents =
    terminalEventKind === null
      ? []
      : projection.runtimeEvents.filter((record) => record.event.kind !== terminalEventKind);
  const terminalRuntimeEvents =
    terminalEventKind === null
      ? projection.runtimeEvents
      : projection.runtimeEvents.filter((record) => record.event.kind === terminalEventKind);
  const persistedSourceEventIds: string[] = [];

  if (preTerminalRuntimeEvents.length > 0) {
    const persisted = await persistSessionRuntimeEvents(database, {
      driverFence,
      records: preTerminalRuntimeEvents,
      sessionId: link.sessionId,
    });
    persistedSourceEventIds.push(...persisted.persistedSourceEventIds);
  }

  let finalAssistantMessage: { id: string } | null = null;
  let preparedAssistantMessage: PreparedAssistantMessageProjection | null = null;

  if (completedTransition && projection.finalAssistantMessageId !== null) {
    if (link.sessionRunId === null) {
      throw new Error("Completed run final message is missing its run scope.");
    }

    finalAssistantMessage = await resolveFinalAssistantMessage(database, {
      messageId: projection.finalAssistantMessageId,
      runId: link.sessionRunId,
      sessionId: link.sessionId,
    });

    preparedAssistantMessage = prepareAssistantMessageProjection({
      createdByAccountId: link.callerId ?? link.creatorId ?? input.driverInstanceId,
      messageId: finalAssistantMessage.id,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
    });
  }

  let terminalRunCommit: Awaited<ReturnType<typeof commitTerminalRunProjection>> | null = null;

  if (terminalRunTransition !== undefined) {
    if (link.sessionRunId === null) {
      throw new Error("Terminal run projection is missing its run scope.");
    }

    const [terminalEvent] = terminalRuntimeEvents;

    if (terminalRuntimeEvents.length !== 1 || terminalEvent === undefined) {
      throw new Error("Terminal run projection requires exactly one terminal runtime event.");
    }

    terminalRunCommit = await commitTerminalRunProjection(database, {
      assistantMessage: preparedAssistantMessage,
      error: terminalRunTransition.error ?? null,
      expectedDriverObservation: {
        connectionId: input.driverConnectionId,
        driverInstanceId: input.driverInstanceId,
        generation: input.driverGeneration,
      },
      runId: link.sessionRunId,
      sessionId: link.sessionId,
      source: "driver",
      targetStatus: terminalRunTransition.status,
      terminalEvent,
    });
    persistedSourceEventIds.push(...terminalRunCommit.persistedSourceEventIds);
    if (terminalRunCommit.kind === "stale") {
      return {
        liveState: null,
        persistedSourceEventIds: [],
      };
    }
  }

  if (terminalRunTransition === undefined) {
    const persistedTerminalEvents = await persistSessionRuntimeEvents(database, {
      driverFence,
      records: terminalRuntimeEvents,
      sessionId: link.sessionId,
    });
    persistedSourceEventIds.push(...persistedTerminalEvents.persistedSourceEventIds);
  }

  let committedLiveState: SessionLiveState | null = null;

  if (projection.liveStateChanged && nextLiveState !== null) {
    committedLiveState = nextLiveState;
  }

  if (
    completedTransition &&
    terminalRunCommit?.kind === "applied" &&
    link.executionOwnerId !== null
  ) {
    await captureServerProductEvent(bindings, {
      distinctId: link.executionOwnerId,
      event: SERVER_PRODUCT_ANALYTICS_EVENTS.taskSucceeded,
      properties: {
        agent_id: link.agentId,
        project_id: link.projectId,
        run_id: link.sessionRunId,
        run_duration_ms: terminalRunCommit.runDurationMs,
        sandbox_id: link.sandboxId,
        sandbox_kind: link.sandboxKind,
        sandbox_subject_kind: link.sandboxSubjectKind,
        session_id: link.sessionId,
        session_type: link.sessionType,
      },
    });
  }

  return {
    liveState: committedLiveState,
    persistedSourceEventIds,
  };
}
