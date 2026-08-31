import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import {
  driverInstancesTable,
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type { PlatformId, RuntimeOperationId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, gt, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { readTerminalEventSemanticAuthority } from "../../../sessions/domain/session-terminal-event-authority";
import { isSealedPublicSessionMessageStream } from "../../../sessions/infrastructure/session-message-event-stream.repository";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { prepareAssistantMessageProjection } from "../../infrastructure/driver-instance/assistant-message-projection";
import type { PreparedAssistantMessageProjection } from "../../infrastructure/driver-instance/assistant-message-projection";
import type {
  HostTerminalRunStatus,
  TerminalRunProjectionSource,
} from "../../infrastructure/driver-instance/completed-run-commit.repository";
import { adoptTerminalRunProjection } from "../../infrastructure/driver-instance/completed-run-commit.repository";
import { getSessionRunSummary } from "../../infrastructure/session-runs/session-run-store.repository";
import { recordCanonicalSessionRunTerminal } from "./session-run-terminal-failure.service";

const TERMINAL_RUN_STATUSES = ["cancelled", "completed", "expired", "failed"] as const;
const TERMINAL_DRIVER_STATUSES = ["failed", "stopped"] as const;
const TERMINAL_RECONCILIATION_RETRY_AFTER_MS = 10 * 60_000;
const TERMINAL_SOURCES = new Set<TerminalRunProjectionSource>([
  "api",
  "driver",
  "maintenance",
  "runtime_operation",
  "system",
  "viewer",
]);

interface TerminalRunCandidate {
  readonly runId: SessionRunId;
  readonly runStatus: SessionRunStatus;
  readonly runStatusOperationId: RuntimeOperationId | null;
  readonly runStatusSeq: number;
  readonly runStatusSource: string;
  readonly runTerminalReconciliationAttemptedAt: number | null;
  readonly runUpdatedAt: number;
  readonly sessionId: SessionId;
  readonly sessionLastRunId: SessionRunId | null;
  readonly sessionStatus: SessionStatus;
}

interface TerminalEventReceipt {
  readonly eventType: string;
  readonly runId: SessionRunId | null;
  readonly semanticHash: string | null;
  readonly sourceEventId: string;
  readonly streamId: string | null;
  readonly terminalEventJson: string | null;
}

interface CompletedAssistantRow {
  readonly contentText: string;
  readonly createdByAccountId: PlatformId;
  readonly id: string;
  readonly planJson: string | null;
  readonly projectionFormat: "event_stream_v3" | "materialized";
  readonly segmentsJson: string | null;
}

export interface TerminalRunReconciliationResult {
  readonly failures: readonly {
    readonly message: string;
    readonly runId: SessionRunId;
    readonly sessionId: SessionId;
  }[];
  readonly reconciledRunIds: readonly SessionRunId[];
  readonly reconciledSessionIds: readonly SessionId[];
}

function terminalEventKind(
  status: SessionRunStatus,
): "run.cancelled" | "run.completed" | "run.failed" {
  switch (status) {
    case "completed":
      return "run.completed";
    case "failed":
      return "run.failed";
    case "cancelled":
    case "expired":
      return "run.cancelled";
    case "queued":
    case "booting":
    case "running":
    case "waiting_input":
      throw new Error(`Expected terminal Session Run status, received ${status}.`);
  }
}

function isHostTerminalRunStatus(status: SessionRunStatus): status is HostTerminalRunStatus {
  return TERMINAL_RUN_STATUSES.some((terminalStatus) => terminalStatus === status);
}

async function findTerminalRunCandidates(
  bindings: ApiBindings,
  limit: number,
): Promise<TerminalRunCandidate[]> {
  const database = getAppDatabase(bindings.DB);
  const expectedEventType = sql<string>`
    CASE ${sessionRunsTable.status}
      WHEN 'completed' THEN 'run.completed'
      WHEN 'failed' THEN 'run.failed'
      ELSE 'run.cancelled'
    END
  `;
  const missingTerminalEvent = notExists(
    database
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, sessionRunsTable.sessionId),
          eq(sessionEventsTable.runId, sessionRunsTable.id),
          sql`${sessionEventsTable.eventType} = ${expectedEventType}`,
        ),
      ),
  );
  const staleSessionProjection = and(
    eq(sessionsTable.lastRunId, sessionRunsTable.id),
    eq(sessionsTable.status, "RUNNING"),
  );
  const retryBefore = currentTimestampMs() - TERMINAL_RECONCILIATION_RETRY_AFTER_MS;

  return database
    .select({
      runId: sessionRunsTable.id,
      runStatus: sessionRunsTable.status,
      runStatusOperationId: sessionRunsTable.statusOperationId,
      runStatusSeq: sessionRunsTable.statusSeq,
      runStatusSource: sessionRunsTable.statusSource,
      runTerminalReconciliationAttemptedAt: sessionRunsTable.terminalReconciliationAttemptedAt,
      runUpdatedAt: sessionRunsTable.updatedAt,
      sessionId: sessionRunsTable.sessionId,
      sessionLastRunId: sessionsTable.lastRunId,
      sessionStatus: sessionsTable.status,
    })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .leftJoin(driverInstancesTable, eq(driverInstancesTable.id, sessionRunsTable.driverInstanceId))
    .where(
      and(
        inArray(sessionRunsTable.status, TERMINAL_RUN_STATUSES),
        or(
          isNull(sessionRunsTable.terminalReconciliationAttemptedAt),
          lte(sessionRunsTable.terminalReconciliationAttemptedAt, retryBefore),
          gt(sessionRunsTable.updatedAt, sessionRunsTable.terminalReconciliationAttemptedAt),
          gt(sessionsTable.updatedAt, sessionRunsTable.terminalReconciliationAttemptedAt),
        ),
        isNull(sessionsTable.archivedAt),
        inArray(sessionsTable.status, ["IDLE", "RESCHEDULING", "RUNNING"]),
        or(
          isNull(sessionRunsTable.driverInstanceId),
          isNull(driverInstancesTable.id),
          inArray(driverInstancesTable.status, TERMINAL_DRIVER_STATUSES),
        ),
        or(staleSessionProjection, missingTerminalEvent),
      ),
    )
    .orderBy(
      asc(
        sql`coalesce(${sessionRunsTable.terminalReconciliationAttemptedAt}, ${sessionRunsTable.updatedAt})`,
      ),
      asc(sessionRunsTable.id),
    )
    .limit(limit)
    .all();
}

async function recordTerminalReconciliationAttempt(
  bindings: ApiBindings,
  candidate: TerminalRunCandidate,
  attemptedAt: number,
): Promise<boolean> {
  const result = await getAppDatabase(bindings.DB)
    .update(sessionRunsTable)
    .set({ terminalReconciliationAttemptedAt: attemptedAt })
    .where(
      and(
        eq(sessionRunsTable.id, candidate.runId),
        eq(sessionRunsTable.status, candidate.runStatus),
        eq(sessionRunsTable.statusSeq, candidate.runStatusSeq),
        eq(sessionRunsTable.statusSource, candidate.runStatusSource),
        eq(sessionRunsTable.updatedAt, candidate.runUpdatedAt),
        candidate.runStatusOperationId === null
          ? isNull(sessionRunsTable.statusOperationId)
          : eq(sessionRunsTable.statusOperationId, candidate.runStatusOperationId),
        candidate.runTerminalReconciliationAttemptedAt === null
          ? isNull(sessionRunsTable.terminalReconciliationAttemptedAt)
          : eq(
              sessionRunsTable.terminalReconciliationAttemptedAt,
              candidate.runTerminalReconciliationAttemptedAt,
            ),
      ),
    )
    .run();
  return getD1ChangeCount(result) > 0;
}

async function readTerminalEventReceipts(
  bindings: ApiBindings,
  runIds: readonly SessionRunId[],
): Promise<Map<SessionRunId, TerminalEventReceipt[]>> {
  if (runIds.length === 0) {
    return new Map();
  }
  const rows = await getAppDatabase(bindings.DB)
    .select({
      eventType: sessionEventsTable.eventType,
      runId: sessionEventsTable.runId,
      semanticHash: sessionEventsTable.semanticHash,
      sourceEventId: sessionEventsTable.sourceEventId,
      streamId: sessionEventsTable.streamId,
      terminalEventJson: sessionEventsTable.terminalEventJson,
    })
    .from(sessionEventsTable)
    .where(
      and(
        inArray(sessionEventsTable.runId, runIds),
        inArray(sessionEventsTable.eventType, ["run.cancelled", "run.completed", "run.failed"]),
      ),
    )
    .all();

  return new Map(
    [...Map.groupBy(rows, (row) => row.runId)].flatMap(([runId, receipts]) =>
      runId === null ? [] : [[runId, receipts]],
    ),
  );
}

export async function assertCanonicalTerminalSessionRunProjection(
  bindings: ApiBindings,
  input: {
    readonly runId: SessionRunId;
    readonly sessionId: SessionId;
    readonly status: HostTerminalRunStatus;
  },
): Promise<void> {
  const run = await getSessionRunSummary(bindings.DB, input.runId);
  if (run?.status !== input.status) {
    throw new Error(`Terminal run ${input.runId} has no unique canonical terminal receipt.`);
  }
  const outcome = await adoptTerminalRunProjection(bindings.DB, {
    runId: input.runId,
    sessionId: input.sessionId,
  });
  if (outcome.kind === "missing" || outcome.kind === "stale") {
    throw new Error(`Terminal run ${input.runId} has no unique canonical terminal receipt.`);
  }
}

async function resolveCompletedAssistant(
  bindings: ApiBindings,
  input: {
    readonly legacy: boolean;
    readonly runId: SessionRunId;
    readonly sessionId: SessionId;
    readonly streamId?: string | null;
  },
): Promise<PreparedAssistantMessageProjection | null> {
  const rows: CompletedAssistantRow[] = await getAppDatabase(bindings.DB)
    .select({
      contentText: sessionMessagesTable.contentText,
      createdByAccountId: sessionMessagesTable.createdByAccountId,
      id: sessionMessagesTable.id,
      planJson: sessionMessagesTable.planJson,
      projectionFormat: sessionMessagesTable.projectionFormat,
      segmentsJson: sessionMessagesTable.segmentsJson,
    })
    .from(sessionMessagesTable)
    .where(
      and(
        eq(sessionMessagesTable.sessionId, input.sessionId),
        eq(sessionMessagesTable.sessionRunId, input.runId),
        eq(sessionMessagesTable.role, "assistant"),
      ),
    )
    .all();

  const isEventStreamReference = (row: CompletedAssistantRow): boolean =>
    row.contentText === "" &&
    row.planJson === null &&
    row.projectionFormat === "event_stream_v3" &&
    row.segmentsJson === null;
  const withoutToolCarrier = (): CompletedAssistantRow[] => {
    const carrier = rows.find((row) => row.id === input.runId);
    if (carrier !== undefined && !isEventStreamReference(carrier)) {
      throw new Error(`Completed run ${input.runId} has an invalid parentless tool carrier.`);
    }
    return rows.filter((row) => row.id !== input.runId);
  };

  if (input.legacy) {
    const authorityRows = withoutToolCarrier();
    if (authorityRows.length !== 1 || authorityRows[0]?.projectionFormat !== "materialized") {
      throw new Error(`Legacy completed run ${input.runId} has ambiguous assistant authority.`);
    }
    return null;
  }

  if (input.streamId === null) {
    if (withoutToolCarrier().length !== 0) {
      throw new Error(
        `Completed run ${input.runId} has assistant rows despite declaring no final stream.`,
      );
    }
    return null;
  }

  const authorityRows =
    input.streamId === undefined
      ? withoutToolCarrier()
      : rows.filter((row) => row.id === input.streamId);
  const otherRows =
    input.streamId === undefined ? [] : rows.filter((row) => row.id !== input.streamId);
  if (input.streamId !== undefined) {
    const carrier = otherRows.find((row) => row.id === input.runId);
    if (
      otherRows.length > 1 ||
      (carrier === undefined && otherRows.length !== 0) ||
      (carrier !== undefined && !isEventStreamReference(carrier))
    ) {
      throw new Error(
        `Completed run ${input.runId} has no unique event-stream assistant reference.`,
      );
    }
  }

  if (authorityRows.length === 0 && input.streamId === undefined) {
    return null;
  }

  const [row] = authorityRows;
  if (authorityRows.length !== 1 || row === undefined || !isEventStreamReference(row)) {
    throw new Error(`Completed run ${input.runId} has no unique event-stream assistant reference.`);
  }
  const sealed = await isSealedPublicSessionMessageStream(bindings.DB, {
    processType: "agent.message.delta",
    runId: input.runId,
    sessionId: input.sessionId,
    streamId: row.id,
  });
  if (!sealed) {
    throw new Error(`Completed run ${input.runId} has no sealed authoritative assistant stream.`);
  }

  return prepareAssistantMessageProjection({
    createdByAccountId: row.createdByAccountId,
    messageId: row.id,
    sessionId: input.sessionId,
    sessionRunId: input.runId,
  });
}

export async function reconcileTerminalSessionRuns(
  bindings: ApiBindings,
  input: {
    readonly limit: number;
  },
): Promise<TerminalRunReconciliationResult> {
  const database = getAppDatabase(bindings.DB);
  const candidates = await findTerminalRunCandidates(bindings, input.limit);
  const runIds = candidates.map((candidate) => candidate.runId);
  const receiptsByRunId = await readTerminalEventReceipts(bindings, runIds);
  const failures: {
    message: string;
    runId: SessionRunId;
    sessionId: SessionId;
  }[] = [];
  const reconciledRunIds: SessionRunId[] = [];
  const reconciledSessionIds = new Set<SessionId>();

  for (const candidate of candidates) {
    try {
      if (!(await recordTerminalReconciliationAttempt(bindings, candidate, currentTimestampMs()))) {
        continue;
      }
      const run = await getSessionRunSummary(bindings.DB, candidate.runId);
      if (run === null) {
        continue;
      }
      if (!isHostTerminalRunStatus(run.status)) {
        continue;
      }
      const terminalStatus = run.status;
      const source = TERMINAL_SOURCES.has(candidate.runStatusSource as TerminalRunProjectionSource)
        ? (candidate.runStatusSource as TerminalRunProjectionSource)
        : null;
      if (source === null) {
        throw new Error(`Terminal run ${run.id} has an unknown durable source.`);
      }
      if (source === "runtime_operation" && candidate.runStatusOperationId === null) {
        throw new Error(`Runtime-operation terminal run ${run.id} has no operation identity.`);
      }
      const receipts = receiptsByRunId.get(run.id) ?? [];
      const expectedKind = terminalEventKind(terminalStatus);
      const matchingReceipts = receipts.filter((receipt) => receipt.eventType === expectedKind);
      const [matchingReceipt] = matchingReceipts;
      const legacy = matchingReceipts.length === 1 && matchingReceipt?.semanticHash === null;
      if (receipts.length > 1 || matchingReceipts.length > 1) {
        throw new Error(`Terminal run ${run.id} has ambiguous durable terminal receipts.`);
      }
      if (
        matchingReceipt !== undefined &&
        matchingReceipt.sourceEventId !== createSessionRunTerminalSourceId(run.id, expectedKind)
      ) {
        throw new Error(`Terminal run ${run.id} has a noncanonical terminal receipt identity.`);
      }
      if (legacy && matchingReceipt?.terminalEventJson !== null) {
        throw new Error(`Terminal run ${run.id} has invalid legacy semantic authority.`);
      }
      const semanticAuthority =
        matchingReceipt === undefined || matchingReceipt.semanticHash === null
          ? null
          : await readTerminalEventSemanticAuthority({
              eventJson: matchingReceipt.terminalEventJson,
              eventType: matchingReceipt.eventType,
              runId: run.id,
              semanticHash: matchingReceipt.semanticHash,
              sessionId: candidate.sessionId,
              sourceEventId: matchingReceipt.sourceEventId,
              streamId: matchingReceipt.streamId,
            });
      const assistantMessage =
        terminalStatus === "completed" && matchingReceipt === undefined
          ? await resolveCompletedAssistant(bindings, {
              legacy,
              runId: run.id,
              sessionId: candidate.sessionId,
            })
          : null;
      const commitKind = await (async () => {
        if (matchingReceipt !== undefined) {
          const outcome = await adoptTerminalRunProjection(bindings.DB, {
            runId: run.id,
            sessionId: candidate.sessionId,
          });
          if (outcome.kind === "missing") {
            throw new Error(`Terminal run ${run.id} lost its durable terminal receipt.`);
          }
          return outcome.kind === "stale" ? null : outcome.kind;
        }

        const outcome = await recordCanonicalSessionRunTerminal(bindings, {
          assistantMessage,
          deliver: false,
          error: run.error,
          ...(source === "runtime_operation"
            ? { expectedSessionOperationId: candidate.runStatusOperationId }
            : {}),
          runId: run.id,
          sessionId: candidate.sessionId,
          source,
          status: terminalStatus,
        });
        return outcome.kind === "stale" ? null : outcome.commitKind;
      })();
      if (commitKind === null) {
        continue;
      }
      if (commitKind === "applied") {
        reconciledRunIds.push(run.id);
      }
      const session = await database
        .select({
          lastRunId: sessionsTable.lastRunId,
          status: sessionsTable.status,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, candidate.sessionId))
        .limit(1)
        .get();
      const expectedSessionStatus = semanticAuthority?.lifecycle ?? "IDLE";
      if (session?.lastRunId !== run.id) {
        continue;
      }
      if (session.status !== expectedSessionStatus) {
        throw new Error(
          `Terminal run ${run.id} did not converge its current Session to ${expectedSessionStatus}.`,
        );
      }
      reconciledSessionIds.add(candidate.sessionId);
    } catch (error) {
      failures.push({
        message: error instanceof Error ? error.message : "Unknown terminal reconciliation error.",
        runId: candidate.runId,
        sessionId: candidate.sessionId,
      });
      logWarn("runtime.terminal_run.reconciliation_failed", {
        ...createErrorLogContext(error),
        runId: candidate.runId,
        sessionId: candidate.sessionId,
      });
    }
  }

  return {
    failures,
    reconciledRunIds,
    reconciledSessionIds: [...reconciledSessionIds],
  };
}
