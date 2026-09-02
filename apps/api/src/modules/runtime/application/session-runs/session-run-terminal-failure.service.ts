import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  RuntimeOperationId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { publishPersistedSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { readTerminalEventSemanticAuthority } from "../../../sessions/domain/session-terminal-event-authority";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import type { PreparedAssistantMessageProjection } from "../../infrastructure/driver-instance/assistant-message-projection";
import { commitTerminalRunProjection } from "../../infrastructure/driver-instance/completed-run-commit.repository";
import type {
  ExpectedTerminalDriverObservation,
  ExpectedTerminalSessionObservation,
  HostTerminalRunStatus,
  TerminalRunProjectionSource,
} from "../../infrastructure/driver-instance/completed-run-commit.repository";
import { createCanonicalDriverRunFailedEvent } from "../../infrastructure/driver-instance/driver-event-canonicalization";
import { getSessionRunSummary } from "../../infrastructure/session-runs/session-run-store.repository";
import {
  createCompletedSessionRunRuntimeEvent,
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
} from "./session-run-view-events.service";

export type CanonicalSessionRunFailureOutcome =
  | { kind: "failed" }
  | { kind: "not_failed"; status: SessionRunSummary["status"] };

export type CanonicalSessionRunTerminalOutcome =
  | {
      commitKind: "applied" | "duplicate";
      kind: "committed";
      run: SessionRunSummary;
    }
  | { kind: "stale"; run: SessionRunSummary };

function terminalRunSummary(
  current: SessionRunSummary,
  input: {
    error: RunError | null;
    status: HostTerminalRunStatus;
  },
  timestamp: string,
): SessionRunSummary {
  return {
    ...current,
    completedAt: current.completedAt ?? timestamp,
    error: input.error,
    startedAt: current.startedAt ?? timestamp,
    status: input.status,
    updatedAt: current.status === input.status ? current.updatedAt : timestamp,
  };
}

async function readRunExecutionIdentity(
  database: D1Database,
  runId: SessionRunId,
): Promise<{ driverInstanceId: DriverInstanceId; runtimeId: string } | null> {
  const row = await getAppDatabase(database)
    .select({
      driverInstanceId: sessionRunsTable.driverInstanceId,
      runtimeId: sql<
        string | null
      >`coalesce(${sessionRunsTable.runtimeId}, ${sessionsTable.runtimeId})`,
    })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .where(eq(sessionRunsTable.id, runId))
    .limit(1)
    .get();

  return row?.driverInstanceId === null || row?.runtimeId === null || row === undefined
    ? null
    : { driverInstanceId: row.driverInstanceId, runtimeId: row.runtimeId };
}

async function hasCompletedWithoutAssistantAuthority(
  database: D1Database,
  input: { readonly runId: SessionRunId; readonly sessionId: SessionId },
): Promise<boolean> {
  const db = getAppDatabase(database);
  const [receipts, assistantMessages] = await Promise.all([
    db
      .select({
        eventType: sessionEventsTable.eventType,
        semanticHash: sessionEventsTable.semanticHash,
        sourceEventId: sessionEventsTable.sourceEventId,
        streamId: sessionEventsTable.streamId,
        terminalEventJson: sessionEventsTable.terminalEventJson,
      })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          eq(sessionEventsTable.runId, input.runId),
          inArray(sessionEventsTable.eventType, ["run.cancelled", "run.completed", "run.failed"]),
        ),
      )
      .all(),
    db
      .select({
        id: sessionMessagesTable.id,
        projectionFormat: sessionMessagesTable.projectionFormat,
      })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, input.sessionId),
          eq(sessionMessagesTable.sessionRunId, input.runId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .all(),
  ]);
  const [receipt] = receipts;
  const finalAssistantMessages = assistantMessages.filter(
    (message) => message.id.toString() !== input.runId,
  );

  if (receipts.length === 0) {
    return finalAssistantMessages.length === 0;
  }
  if (
    receipts.length !== 1 ||
    receipt?.eventType !== "run.completed" ||
    receipt.sourceEventId !== createSessionRunTerminalSourceId(input.runId, "run.completed")
  ) {
    return false;
  }
  if (receipt.semanticHash === null) {
    if (receipt.terminalEventJson !== null) {
      throw new Error(`Session run ${input.runId} has an invalid legacy terminal authority.`);
    }
    return (
      finalAssistantMessages.length === 1 &&
      finalAssistantMessages[0]?.projectionFormat === "materialized"
    );
  }
  const authority = await readTerminalEventSemanticAuthority({
    eventJson: receipt.terminalEventJson,
    eventType: receipt.eventType,
    runId: input.runId,
    semanticHash: receipt.semanticHash,
    sessionId: input.sessionId,
    sourceEventId: receipt.sourceEventId,
    streamId: receipt.streamId,
  });
  return authority.finalMessageId === null && finalAssistantMessages.length === 0;
}

export async function recordCanonicalSessionRunFailure(
  bindings: ApiBindings,
  input: {
    error: RunError;
    runId: SessionRunId;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
  },
): Promise<CanonicalSessionRunFailureOutcome> {
  const outcome = await recordCanonicalSessionRunTerminal(bindings, {
    assistantMessage: null,
    error: input.error,
    runId: input.runId,
    sessionId: input.sessionId,
    source: input.source,
    status: "failed",
  });

  return outcome.kind === "committed"
    ? { kind: "failed" }
    : { kind: "not_failed", status: outcome.run.status };
}

export async function recordCanonicalSessionRunTerminal(
  bindings: ApiBindings,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    deliver?: boolean;
    error: RunError | null;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    expectedRunStatus?: SessionRunSummary["status"];
    expectedSessionObservation?: ExpectedTerminalSessionObservation;
    expectedSessionOperationId?: RuntimeOperationId | null;
    lifecycle?: "IDLE" | "TERMINATED";
    runId: SessionRunId;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
    sourceEventId?: string;
    status: HostTerminalRunStatus;
    timestampMs?: number;
  },
): Promise<CanonicalSessionRunTerminalOutcome> {
  const current = await getSessionRunSummary(bindings.DB, input.runId);
  if (current === null) {
    throw new Error("Session Run was not found while recording its terminal projection.");
  }
  if (
    current.status !== input.status &&
    (current.status === "cancelled" ||
      current.status === "completed" ||
      current.status === "expired" ||
      current.status === "failed")
  ) {
    return { kind: "stale", run: current };
  }
  if (input.expectedRunStatus !== undefined && current.status !== input.expectedRunStatus) {
    return { kind: "stale", run: current };
  }

  const error = current.status === input.status ? current.error : input.error;
  if (input.status === "failed" && error === null) {
    throw new Error("A failed Session Run requires one durable RunError.");
  }
  const completedReceiptWithoutAssistant =
    input.status === "completed" && input.assistantMessage === null
      ? await hasCompletedWithoutAssistantAuthority(bindings.DB, {
          runId: input.runId,
          sessionId: input.sessionId,
        })
      : false;
  if (
    input.status === "completed" &&
    (error !== null || (input.assistantMessage === null && !completedReceiptWithoutAssistant))
  ) {
    throw new Error("A completed Session Run requires one sealed final assistant reference.");
  }
  if (input.status !== "completed" && input.assistantMessage !== null) {
    throw new Error("Only a completed Session Run can reference a final assistant message.");
  }

  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const timestamp = toIsoString(timestampMs);
  const run = terminalRunSummary(current, { error, status: input.status }, timestamp);
  const kind = input.status === "expired" ? "run.cancelled" : (`run.${input.status}` as const);
  const sourceEventId = input.sourceEventId ?? createSessionRunTerminalSourceId(input.runId, kind);
  const lifecycle = input.lifecycle ?? "IDLE";
  const event = await (async () => {
    if (input.status === "completed") {
      return input.assistantMessage === null
        ? createSessionRunUpdatedEvent(run, input.sessionId, lifecycle, sourceEventId)
        : createCompletedSessionRunRuntimeEvent({
            finalMessageId: input.assistantMessage.id,
            lifecycle,
            run,
            sessionId: input.sessionId,
            sourceEventId,
          });
    }
    if (input.status !== "failed") {
      return createSessionRunUpdatedEvent(run, input.sessionId, lifecycle, sourceEventId);
    }

    const execution =
      lifecycle === "IDLE" && input.source === "driver" && input.sourceEventId === undefined
        ? await readRunExecutionIdentity(bindings.DB, input.runId)
        : null;
    return execution === null
      ? createFailedSessionRunRuntimeEvent({
          lifecycle,
          run,
          runError: error!,
          sessionId: input.sessionId,
          sourceEventId,
        })
      : createCanonicalDriverRunFailedEvent({
          driverInstanceId: execution.driverInstanceId,
          error: error!,
          id: createPlatformId<RuntimeEventId>(),
          occurredAt: timestamp,
          runId: input.runId,
          runtimeId: execution.runtimeId,
          sessionId: input.sessionId,
          traceId: run.traceId,
        });
  })();
  const committed = await commitTerminalRunProjection(bindings.DB, {
    assistantMessage: input.assistantMessage,
    error,
    ...(input.expectedDriverObservation === undefined
      ? {}
      : { expectedDriverObservation: input.expectedDriverObservation }),
    ...(input.expectedRunStatus === undefined
      ? {}
      : { expectedRunStatus: input.expectedRunStatus }),
    ...(input.expectedSessionObservation === undefined
      ? {}
      : { expectedSessionObservation: input.expectedSessionObservation }),
    ...(input.expectedSessionOperationId === undefined
      ? {}
      : { expectedSessionOperationId: input.expectedSessionOperationId }),
    runId: input.runId,
    sessionId: input.sessionId,
    source: input.source,
    targetStatus: input.status,
    terminalEvent: { event, occurredAt: timestampMs, sourceEventId },
    timestampMs,
  });
  const persisted = await getSessionRunSummary(bindings.DB, input.runId);
  if (persisted === null) {
    throw new Error("Session Run disappeared after its terminal projection.");
  }

  if (committed.kind === "stale") {
    return { kind: "stale", run: persisted };
  }
  if (persisted.status !== input.status) {
    throw new Error("Atomic terminal projection returned without its exact Session Run status.");
  }
  if (input.deliver !== false) {
    await publishPersistedSessionRuntimeEvents({
      bindings,
      events: [event],
      sessionId: input.sessionId,
    });
  }
  return { commitKind: committed.kind, kind: "committed", run: persisted };
}
