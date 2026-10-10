import { sessionsTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  finalizeSessionModelCallUsage,
  upsertSessionModelCallUsage,
} from "../../../sessions/infrastructure/session-model-call.repository";
import {
  persistSessionRuntimeEvents,
  prepareSessionRuntimeEventInsert,
} from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { resetNativeResumeCheckpoint } from "../native-checkpoint-reset";
import {
  discardUncommittedCompletionCheckpoint,
  prepareSessionRunCompletionCheckpoint,
} from "../session-runs/session-run-completion-checkpoint";
import {
  getSessionRunSummary,
  setSessionRunStatus,
} from "../session-runs/session-run-store.repository";
import type { SessionRunTransitionOutcome } from "../session-runs/session-run-store.repository";
import {
  prepareAssistantMessageProjection,
  readDurableFinalAssistantMessageSnapshot,
} from "./assistant-message-projection";
import { compactRuntimeDriverRunTransitions } from "./event-projection";
import type { ProjectRuntimeDriverEventsResult, SessionLiveState } from "./event-types";
import { terminalConflict } from "./terminal-conflict";
import { releaseTerminalDriverInstanceSessionRun } from "./terminal-run-release";

type DriverProjectedSessionRunStatusInput = Parameters<typeof setSessionRunStatus>[1];

async function setDriverProjectedSessionRunStatus(
  database: D1Database,
  input: DriverProjectedSessionRunStatusInput,
): Promise<SessionRunTransitionOutcome> {
  const outcome = await setSessionRunStatus(database, input);
  if (outcome.kind !== "applied" && outcome.kind !== "duplicate") {
    throw terminalConflict({
      currentStatus: "currentStatus" in outcome ? outcome.currentStatus : null,
      runId: input.runId,
      reason: "Driver event lost the Run transition.",
    });
  }
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
  const persistedSourceEventIds: string[] = [];
  if (projection.sessionReset !== null) {
    await resetNativeResumeCheckpoint(bindings, {
      ...projection.sessionReset,
      driverInstanceId: input.driverInstanceId,
      link,
    });
    persistedSourceEventIds.push(projection.sessionReset.record.sourceEventId);
  }
  const transitions = compactRuntimeDriverRunTransitions(projection.transitions);
  const [runTransition] = transitions;
  const terminalRecord = projection.runtimeEvents.find((record) =>
    ["run.completed", "run.failed", "run.cancelled"].includes(record.event.kind),
  );
  if (
    projection.runtimeEvents.filter((record) =>
      ["run.completed", "run.failed", "run.cancelled"].includes(record.event.kind),
    ).length > 1
  ) {
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: link.sessionRunId,
      reason: "A batch cannot commit multiple terminal events.",
    });
  }
  const shouldReleaseDriverRun = terminalRecord !== undefined;
  const completedTransition = runTransition?.status === "completed" ? runTransition : undefined;
  let runTransitionOutcome: SessionRunTransitionOutcome | null = null;

  if (runTransition?.status === "running" && link.sessionRunId !== null) {
    runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
      runId: link.sessionRunId,
      source: "driver",
      status: "running",
    });
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

  const nonTerminalRecords = projection.runtimeEvents.filter(
    (record) => record !== terminalRecord && record !== projection.sessionReset?.record,
  );
  if (nonTerminalRecords.length > 0) {
    const persisted = await persistSessionRuntimeEvents(database, {
      records: nonTerminalRecords,
      sessionId: link.sessionId,
    });
    persistedSourceEventIds.push(...persisted.persistedSourceEventIds);
  }

  if (terminalRecord !== undefined && link.sessionRunId !== null && runTransition !== undefined) {
    if (completedTransition !== undefined && projection.checkpoint === null) {
      throw terminalConflict({
        currentStatus: link.sessionRunStatus,
        runId: link.sessionRunId,
        sourceEventId: terminalRecord.sourceEventId,
        reason: "Run completion requires a native checkpoint descriptor.",
      });
    }
    let finalMessage = null;
    if (completedTransition !== undefined && projection.finalAssistantMessageId !== null) {
      const snapshot = await readDurableFinalAssistantMessageSnapshot(database, {
        messageId: projection.finalAssistantMessageId,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
      });
      if (snapshot === null) {
        throw terminalConflict({
          currentStatus: link.sessionRunStatus,
          runId: link.sessionRunId,
          sourceEventId: terminalRecord.sourceEventId,
          reason:
            "Run completion references an assistant message without a complete durable snapshot.",
        });
      }
      finalMessage = await prepareAssistantMessageProjection(database, {
        createdByAccountId: link.callerId ?? link.creatorId ?? input.driverInstanceId,
        driverInstanceId: input.driverInstanceId,
        messageId: snapshot.id,
        messageText: snapshot.text,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
        state: nextLiveState,
      });
    }
    // The receipt receives its sequence only when the terminal batch commits.
    const receipt = await prepareSessionRuntimeEventInsert(database, {
      record: terminalRecord,
      sessionId: link.sessionId,
    });
    // A concurrent identical delivery already committed the entire terminal batch.
    if (receipt !== null) {
      const completionCheckpoint =
        completedTransition === undefined || projection.checkpoint === null
          ? undefined
          : await prepareSessionRunCompletionCheckpoint(bindings, link, projection.checkpoint);
      if (completedTransition !== undefined && completionCheckpoint === undefined) {
        const currentRun = await getSessionRunSummary(database, link.sessionRunId);
        throw terminalConflict({
          currentStatus: currentRun?.status ?? null,
          runId: link.sessionRunId,
          sourceEventId: terminalRecord.sourceEventId,
          reason:
            "Run completion requires a new committed checkpoint and canonical terminal event.",
        });
      }
      runTransitionOutcome = await setDriverProjectedSessionRunStatus(database, {
        ...(completionCheckpoint === undefined ? {} : { completionCheckpoint }),
        error: runTransition.error ?? null,
        runId: link.sessionRunId,
        source: "driver",
        status: runTransition.status,
        terminalProjection: { receipt, finalMessage },
      }).finally(() => discardUncommittedCompletionCheckpoint(bindings, completionCheckpoint));
      if (runTransitionOutcome.kind !== "applied") {
        throw terminalConflict({
          currentStatus:
            "currentStatus" in runTransitionOutcome ? runTransitionOutcome.currentStatus : null,
          runId: link.sessionRunId,
          sourceEventId: terminalRecord.sourceEventId,
          reason: "A different terminal event already completed this Run.",
        });
      }
      persistedSourceEventIds.push(receipt.row.sourceEventId);
    }
    await finalizeSessionModelCallUsage(database, link.sessionRunId);
  }

  const committedLiveState = projection.liveStateChanged ? nextLiveState : null;

  if (
    runTransition === undefined &&
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
