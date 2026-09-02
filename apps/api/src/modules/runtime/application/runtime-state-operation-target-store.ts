import { sandboxSessionsTable, sessionEventsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AgentId,
  PlatformId,
  RuntimeEventId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEventSemanticHash } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../sessions/domain/session-lifecycle";
import { createSessionRuntimeEventProjection } from "../../sessions/domain/session-runtime-event-projection";
import { createSessionStatusTransitionPatch } from "../infrastructure/session-runs/session-lifecycle-projection.repository";
import {
  createRuntimeOperationEventAuthorityJson,
  readRuntimeOperationEventIdentity,
  readRuntimeOperationEventAuthority,
} from "./runtime-state-operation-event-authority";
import type { RuntimeOperationEventStatus } from "./runtime-state-operation-event-authority";
import { createRuntimeOperationSessionEvent } from "./runtime-state-operation-events";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";

export interface RuntimeSessionTarget {
  readonly agentId: AgentId | null;
  readonly creatorAccountId: PlatformId;
  readonly lastRunId: SessionRunId | null;
  readonly sandboxId: SandboxId;
  readonly sessionId: SessionId;
  readonly sessionRuntimeEventSeqCursor: number;
  readonly sessionStatusOperationId: RuntimeOperationId | null;
  readonly sessionStatusSeq: number;
  readonly sessionStatus: "IDLE" | "RUNNING" | "RESCHEDULING";
  readonly sessionUpdatedAt: number;
}

export type RuntimeSessionLifecycleTarget = Pick<
  RuntimeSessionTarget,
  | "lastRunId"
  | "sessionId"
  | "sessionRuntimeEventSeqCursor"
  | "sessionStatus"
  | "sessionStatusOperationId"
  | "sessionStatusSeq"
  | "sessionUpdatedAt"
> & { readonly agentId?: AgentId | null };

export type SessionLifecycleEventProjectionOutcome =
  | { readonly kind: "applied" | "duplicate" }
  | { readonly kind: "stale" };

export const RUNTIME_TARGET_SESSION_STATUSES: RuntimeSessionTarget["sessionStatus"][] = [
  "IDLE",
  "RUNNING",
  "RESCHEDULING",
];
const RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE = 25;

export interface RuntimeSessionTargetTransition {
  readonly current: RuntimeSessionTarget;
}

export interface StaleRuntimeOperationTarget extends RuntimeSessionTarget {
  readonly operationId: RuntimeOperationId;
}

function sessionStatusOperationCondition(operationId: RuntimeOperationId | null) {
  return operationId === null
    ? [isNull(sessionsTable.statusOperationId)]
    : [eq(sessionsTable.statusOperationId, operationId)];
}

function sessionLastRunCondition(lastRunId: SessionRunId | null) {
  return lastRunId === null
    ? isNull(sessionsTable.lastRunId)
    : eq(sessionsTable.lastRunId, lastRunId);
}

function sessionTargetFreshnessCondition(
  target: RuntimeSessionTarget,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
  },
) {
  const expectedOperationId =
    input.expectedOperationId === undefined
      ? target.sessionStatusOperationId
      : input.expectedOperationId;

  return and(
    eq(sessionsTable.id, target.sessionId),
    eq(sessionsTable.status, input.expectedStatus ?? target.sessionStatus),
    eq(sessionsTable.statusSeq, target.sessionStatusSeq),
    eq(sessionsTable.runtimeEventSeqCursor, target.sessionRuntimeEventSeqCursor),
    sessionLastRunCondition(target.lastRunId),
    ...sessionStatusOperationCondition(expectedOperationId),
  );
}

interface PreparedSessionLifecycleEvent {
  readonly event: RuntimeEventEnvelope;
  readonly eventType: string;
  readonly occurredAtMs: number;
  readonly projection: ReturnType<typeof createSessionRuntimeEventProjection>;
  readonly semanticHash: string;
  readonly sourceEventId: string;
  readonly runtimeOperationEventJson: string | null;
}

async function prepareSessionLifecycleEvent(
  event: RuntimeEventEnvelope,
  runtimeOperation?: {
    readonly agentId: AgentId;
    readonly operationId: RuntimeOperationId;
    readonly status: RuntimeOperationEventStatus;
  },
): Promise<PreparedSessionLifecycleEvent> {
  const occurredAtMs = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("Session lifecycle event time must be a valid ISO timestamp.");
  }
  if (event.sourceEventId === undefined) {
    throw new Error("Atomic Session lifecycle events require one stable source event ID.");
  }

  const projection = createSessionRuntimeEventProjection(event);
  return {
    event,
    eventType: projection.eventType,
    occurredAtMs,
    projection,
    semanticHash: await createRuntimeEventSemanticHash(event),
    sourceEventId: event.sourceEventId,
    runtimeOperationEventJson:
      runtimeOperation === undefined
        ? null
        : createRuntimeOperationEventAuthorityJson({
            event,
            ...runtimeOperation,
            sessionId: event.sessionId,
          }),
  };
}

function createSessionLifecycleEventInsertStatements(
  database: D1Database,
  input: {
    readonly prepared: PreparedSessionLifecycleEvent;
    readonly target: {
      readonly lastRunId: SessionRunId | null;
      readonly operationId: RuntimeOperationId | null;
      readonly runtimeEventSeqCursor: number;
      readonly sessionId: SessionId;
      readonly status: "IDLE" | "RESCHEDULING" | "TERMINATED";
      readonly statusSeq: number;
      readonly updatedAt: number;
    };
  },
): [D1PreparedStatement, D1PreparedStatement] {
  const { event, projection } = input.prepared;
  const target = input.target;

  return [
    database
      .prepare(
        `INSERT INTO session_event (
           agent_id, content_text, created_at, ended_at, event_type, family, id,
           occurred_at, process_status, process_type, run_id, semantic_hash,
           runtime_operation_event_json, seq,
           session_id, source_event_id, source, stream_id, tool_call_id,
           tool_input_delta_json, tool_input_json, tool_name, tool_output_delta_text,
           tool_output_text, tool_parent_message_id, tool_result_message_id, tool_status,
           tokens, trace_id, visibility
         )
         SELECT
           s.agent_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, s.id, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?
         FROM session AS s
         WHERE s.id = ?
           AND s.archived_at IS NULL
           AND s.cleanup_operation_kind IS NULL
           AND s.last_run_id IS ?
           AND s.runtime_event_seq_cursor = ?
           AND s.status = ?
           AND s.status_operation_id IS ?
           AND s.status_seq = ?
           AND s.updated_at = ?
         ON CONFLICT(session_id, source_event_id) DO NOTHING`,
      )
      .bind(
        projection.contentText,
        input.prepared.occurredAtMs,
        input.prepared.occurredAtMs,
        projection.eventType,
        projection.family,
        event.id,
        input.prepared.occurredAtMs,
        projection.processStatus,
        projection.processType,
        projection.runId,
        input.prepared.semanticHash,
        input.prepared.runtimeOperationEventJson,
        target.runtimeEventSeqCursor,
        input.prepared.sourceEventId,
        projection.source,
        projection.streamId,
        projection.toolCallId,
        projection.toolInputDeltaJson,
        projection.toolInputJson,
        projection.toolName,
        projection.toolOutputDeltaText,
        projection.toolOutputText,
        projection.toolParentMessageId,
        projection.toolResultMessageId,
        projection.toolStatus,
        projection.tokens,
        projection.traceId,
        projection.visibility,
        target.sessionId,
        target.lastRunId,
        target.runtimeEventSeqCursor,
        target.status,
        target.operationId,
        target.statusSeq,
        target.updatedAt,
      ),
    database
      .prepare(
        `INSERT INTO session_event (id)
         SELECT ?
         WHERE EXISTS (
           SELECT 1
           FROM session AS s
           WHERE s.id = ?
             AND s.archived_at IS NULL
             AND s.cleanup_operation_kind IS NULL
             AND s.last_run_id IS ?
             AND s.runtime_event_seq_cursor = ?
             AND s.status = ?
             AND s.status_operation_id IS ?
             AND s.status_seq = ?
             AND s.updated_at = ?
         )
           AND NOT EXISTS (
             SELECT 1
             FROM session_event AS event
             WHERE event.session_id = ?
               AND event.source_event_id = ?
               AND event.event_type = ?
               AND event.semantic_hash = ?
               AND event.runtime_operation_event_json IS ?
               AND event.seq = ?
           )`,
      )
      .bind(
        createPlatformId<RuntimeEventId>(),
        target.sessionId,
        target.lastRunId,
        target.runtimeEventSeqCursor,
        target.status,
        target.operationId,
        target.statusSeq,
        target.updatedAt,
        target.sessionId,
        input.prepared.sourceEventId,
        input.prepared.eventType,
        input.prepared.semanticHash,
        input.prepared.runtimeOperationEventJson,
        target.runtimeEventSeqCursor,
      ),
  ];
}

async function getSessionLifecycleEventReceipt(
  database: D1Database,
  input: Pick<
    PreparedSessionLifecycleEvent,
    "eventType" | "runtimeOperationEventJson" | "semanticHash" | "sourceEventId"
  > & {
    readonly sessionId: SessionId;
  },
): Promise<{ readonly exact: boolean; readonly seq: number } | null> {
  const receipt = await getAppDatabase(database)
    .select({
      eventType: sessionEventsTable.eventType,
      runtimeOperationEventJson: sessionEventsTable.runtimeOperationEventJson,
      semanticHash: sessionEventsTable.semanticHash,
      seq: sessionEventsTable.seq,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.sourceEventId, input.sourceEventId),
      ),
    )
    .limit(1)
    .get();

  return receipt === undefined
    ? null
    : {
        exact:
          receipt.eventType === input.eventType &&
          receipt.runtimeOperationEventJson === input.runtimeOperationEventJson &&
          receipt.semanticHash === input.semanticHash,
        seq: receipt.seq,
      };
}

export async function listRuntimeSessionTargetsForSandboxIds(
  database: D1Database,
  sandboxIds: readonly SandboxId[],
): Promise<RuntimeSessionTarget[]> {
  const uniqueSandboxIds = [...new Set(sandboxIds)];

  if (uniqueSandboxIds.length === 0) {
    return [];
  }

  return getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      creatorAccountId: sessionsTable.creatorAccountId,
      lastRunId: sessionsTable.lastRunId,
      sandboxId: sandboxSessionsTable.sandboxId,
      sessionId: sessionsTable.id,
      sessionRuntimeEventSeqCursor: sessionsTable.runtimeEventSeqCursor,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sql<RuntimeSessionTarget["sessionStatus"]>`${sessionsTable.status}`,
      sessionUpdatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .innerJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .where(
      and(
        inArray(sandboxSessionsTable.sandboxId, uniqueSandboxIds),
        eq(sandboxSessionsTable.status, "active"),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        inArray(sessionsTable.status, RUNTIME_TARGET_SESSION_STATUSES),
      ),
    )
    .all();
}

export async function transitionRuntimeTargetSessionStatus(
  database: D1Database,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
    readonly operationId?: RuntimeOperationId | null;
    readonly status: RuntimeSessionTarget["sessionStatus"];
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const transitions: RuntimeSessionTargetTransition[] = [];

  for (
    let index = 0;
    index < input.targets.length;
    index += RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE
  ) {
    transitions.push(
      ...(await transitionRuntimeTargetSessionStatusBatch(database, {
        ...input,
        targets: input.targets.slice(index, index + RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE),
      })),
    );
  }

  return transitions;
}

async function transitionRuntimeTargetSessionStatusBatch(
  database: D1Database,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
    readonly operationId?: RuntimeOperationId | null;
    readonly status: RuntimeSessionTarget["sessionStatus"];
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const timestampMs = currentTimestampMs();
  const whereClause = and(
    isNull(sessionsTable.archivedAt),
    or(...input.targets.map((target) => sessionTargetFreshnessCondition(target, input))),
  );
  const results = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        status: input.status,
        timestampMs,
      }),
    )
    .where(whereClause)
    .returning({
      id: sessionsTable.id,
      status_operation_id: sessionsTable.statusOperationId,
      status_seq: sessionsTable.statusSeq,
    })
    .all();

  const updatedById = new Map(results.map((row) => [row.id, row]));
  return input.targets.flatMap((target) => {
    const updated = updatedById.get(target.sessionId);

    if (!updated) {
      return [];
    }

    return [
      {
        current: {
          ...target,
          sessionStatus: input.status,
          sessionStatusOperationId: updated.status_operation_id,
          sessionStatusSeq: updated.status_seq,
          sessionUpdatedAt: timestampMs,
        },
      },
    ];
  });
}

export async function commitSessionLifecycleEventProjection(
  database: D1Database,
  input: {
    readonly event: RuntimeEventEnvelope;
    readonly runtimeOperation?: {
      readonly operationId: RuntimeOperationId;
      readonly status: RuntimeOperationEventStatus;
    };
    readonly status: "IDLE" | "TERMINATED";
    readonly target: RuntimeSessionLifecycleTarget;
    readonly timestampMs: number;
  },
): Promise<SessionLifecycleEventProjectionOutcome> {
  if (input.runtimeOperation !== undefined && input.target.agentId == null) {
    throw new Error("Runtime operation lifecycle events require an Agent-bound Session.");
  }
  const prepared = await prepareSessionLifecycleEvent(
    input.event,
    input.runtimeOperation === undefined
      ? undefined
      : { agentId: input.target.agentId!, ...input.runtimeOperation },
  );
  if (input.runtimeOperation?.status === "ready") {
    const claim = await getRuntimeOperationEventReceipt(database, {
      agentId: input.target.agentId!,
      operationId: input.runtimeOperation.operationId,
      sessionId: input.target.sessionId,
      status: "updating",
    });
    const ready = readRuntimeOperationEventIdentity(input.event, {
      agentId: input.target.agentId!,
      operationId: input.runtimeOperation.operationId,
      sessionId: input.target.sessionId,
      status: "ready",
    });
    if (claim === null) {
      throw new Error(
        `Runtime operation ready source ${prepared.sourceEventId} has no canonical claim.`,
      );
    }
    if (!runtimeOperationEventIdentitiesEqual(claim, ready)) {
      throw new Error(
        `Runtime operation ready source ${prepared.sourceEventId} conflicts with its claim.`,
      );
    }
  }
  if (prepared.event.sessionId !== input.target.sessionId) {
    throw new Error("Session lifecycle event does not match its target Session.");
  }
  if (prepared.occurredAtMs !== input.timestampMs) {
    throw new Error("Session lifecycle event time does not match its projection timestamp.");
  }

  const receiptInput = {
    eventType: prepared.eventType,
    runtimeOperationEventJson: prepared.runtimeOperationEventJson,
    semanticHash: prepared.semanticHash,
    sessionId: input.target.sessionId,
    sourceEventId: prepared.sourceEventId,
  };
  const existingReceipt = await getSessionLifecycleEventReceipt(database, receiptInput);
  if (existingReceipt !== null && !existingReceipt.exact) {
    throw new Error(
      `Session lifecycle source ${prepared.sourceEventId} conflicts with its durable receipt.`,
    );
  }

  let changed = 0;
  if (existingReceipt !== null) {
    const result = await database
      .prepare(
        `UPDATE session
            SET status = ?,
                status_operation_id = NULL,
                status_seq = status_seq + 1,
                updated_at = ?
          WHERE id = ?
            AND archived_at IS NULL
            AND cleanup_operation_kind IS NULL
            AND last_run_id IS ?
            AND runtime_event_seq_cursor = ?
            AND status = ?
            AND status_operation_id IS ?
            AND status_seq = ?
            AND updated_at = ?
            AND EXISTS (
              SELECT 1
              FROM session_event AS event
              WHERE event.session_id = ?
                AND event.source_event_id = ?
                AND event.event_type = ?
                AND event.runtime_operation_event_json IS ?
                AND event.semantic_hash = ?
            )`,
      )
      .bind(
        input.status,
        input.timestampMs,
        input.target.sessionId,
        input.target.lastRunId,
        input.target.sessionRuntimeEventSeqCursor,
        input.target.sessionStatus,
        input.target.sessionStatusOperationId,
        input.target.sessionStatusSeq,
        input.target.sessionUpdatedAt,
        input.target.sessionId,
        prepared.sourceEventId,
        prepared.eventType,
        prepared.runtimeOperationEventJson,
        prepared.semanticHash,
      )
      .run();
    changed = getD1ChangeCount(result);
  } else {
    const nextEventSeq = input.target.sessionRuntimeEventSeqCursor + 1;
    const nextStatusSeq = input.target.sessionStatusSeq + 1;
    const eventStatements = createSessionLifecycleEventInsertStatements(database, {
      prepared,
      target: {
        lastRunId: input.target.lastRunId,
        operationId: null,
        runtimeEventSeqCursor: nextEventSeq,
        sessionId: input.target.sessionId,
        status: input.status,
        statusSeq: nextStatusSeq,
        updatedAt: input.timestampMs,
      },
    });
    const results = await database.batch([
      database
        .prepare(
          `UPDATE session
              SET runtime_event_seq_cursor = runtime_event_seq_cursor + 1,
                  status = ?,
                  status_operation_id = NULL,
                  status_seq = status_seq + 1,
                  updated_at = ?
            WHERE id = ?
              AND archived_at IS NULL
              AND cleanup_operation_kind IS NULL
              AND last_run_id IS ?
              AND runtime_event_seq_cursor = ?
              AND status = ?
              AND status_operation_id IS ?
              AND status_seq = ?
              AND updated_at = ?`,
        )
        .bind(
          input.status,
          input.timestampMs,
          input.target.sessionId,
          input.target.lastRunId,
          input.target.sessionRuntimeEventSeqCursor,
          input.target.sessionStatus,
          input.target.sessionStatusOperationId,
          input.target.sessionStatusSeq,
          input.target.sessionUpdatedAt,
        ),
      ...eventStatements,
    ]);
    changed = getD1ChangeCount(results[0]);
  }

  if (changed > 0) {
    return { kind: "applied" };
  }

  const [receipt, session] = await Promise.all([
    getSessionLifecycleEventReceipt(database, receiptInput),
    database
      .prepare(
        `SELECT archived_at, cleanup_operation_kind, last_run_id,
                runtime_event_seq_cursor, status, status_operation_id
           FROM session
          WHERE id = ?`,
      )
      .bind(input.target.sessionId)
      .first<{
        archived_at: number | null;
        cleanup_operation_kind: string | null;
        last_run_id: string | null;
        runtime_event_seq_cursor: number;
        status: string;
        status_operation_id: string | null;
      }>(),
  ]);
  if (
    receipt?.exact === true &&
    session?.archived_at === null &&
    session.cleanup_operation_kind === null &&
    session.last_run_id === input.target.lastRunId &&
    session.runtime_event_seq_cursor >= receipt.seq &&
    session.status === input.status &&
    session.status_operation_id === null
  ) {
    return { kind: "duplicate" };
  }

  return { kind: "stale" };
}

interface RuntimeOperationEventReceipt {
  readonly agentId: AgentId;
  readonly deploymentVersionId: RuntimeOperationEvent["deploymentVersionId"] | null;
  readonly deploymentVersionNumber: RuntimeOperationEvent["deploymentVersionNumber"] | null;
  readonly eventId: string;
  readonly eventJson: string;
  readonly eventType: string;
  readonly occurredAt: number;
  readonly operation: RuntimeOperationEvent["operation"];
  readonly semanticHash: string;
  readonly source: string;
  readonly sourceEventId: string;
  readonly visibility: string;
  readonly seq: number;
}

async function getRuntimeOperationEventReceipt(
  database: D1Database,
  input: {
    readonly agentId: AgentId;
    readonly operationId: RuntimeOperationId;
    readonly sessionId: SessionId;
    readonly status: RuntimeOperationEventStatus;
  },
): Promise<RuntimeOperationEventReceipt | null> {
  const sourceEventId = `runtime-operation:${input.operationId}:${input.sessionId}:${input.status}`;
  const receipt = await getAppDatabase(database)
    .select({
      agentId: sessionEventsTable.agentId,
      eventId: sessionEventsTable.id,
      eventJson: sessionEventsTable.runtimeOperationEventJson,
      eventType: sessionEventsTable.eventType,
      occurredAt: sessionEventsTable.occurredAt,
      semanticHash: sessionEventsTable.semanticHash,
      seq: sessionEventsTable.seq,
      source: sessionEventsTable.source,
      sourceEventId: sessionEventsTable.sourceEventId,
      visibility: sessionEventsTable.visibility,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.sessionId),
        eq(sessionEventsTable.sourceEventId, sourceEventId),
      ),
    )
    .limit(1)
    .get();

  if (receipt === undefined) {
    return null;
  }
  const authority = await readRuntimeOperationEventAuthority({
    agentId: input.agentId,
    eventId: receipt.eventId,
    eventJson: receipt.eventJson,
    eventType: receipt.eventType,
    occurredAt: receipt.occurredAt,
    operationId: input.operationId,
    rowAgentId: receipt.agentId,
    semanticHash: receipt.semanticHash,
    sessionId: input.sessionId,
    source: receipt.source,
    sourceEventId: receipt.sourceEventId,
    status: input.status,
    visibility: receipt.visibility,
  });
  if (receipt.eventJson === null || receipt.semanticHash === null) {
    throw new Error(
      `Runtime operation ${input.status} source ${sourceEventId} has no semantic authority.`,
    );
  }

  return {
    ...receipt,
    agentId: authority.agentId,
    deploymentVersionId: authority.deploymentVersionId,
    deploymentVersionNumber: authority.deploymentVersionNumber,
    eventJson: receipt.eventJson,
    operation: authority.operation,
    semanticHash: receipt.semanticHash,
  };
}

function runtimeOperationEventReceiptsEqual(
  left: RuntimeOperationEventReceipt,
  right: RuntimeOperationEventReceipt,
): boolean {
  return (
    left.deploymentVersionId === right.deploymentVersionId &&
    left.deploymentVersionNumber === right.deploymentVersionNumber &&
    left.eventId === right.eventId &&
    left.eventJson === right.eventJson &&
    left.eventType === right.eventType &&
    left.occurredAt === right.occurredAt &&
    left.operation === right.operation &&
    left.semanticHash === right.semanticHash &&
    left.seq === right.seq &&
    left.source === right.source &&
    left.sourceEventId === right.sourceEventId &&
    left.visibility === right.visibility
  );
}

function runtimeOperationEventIdentitiesEqual(
  left: Pick<
    RuntimeOperationEventReceipt,
    "agentId" | "deploymentVersionId" | "deploymentVersionNumber" | "operation"
  >,
  right: Pick<
    RuntimeOperationEventReceipt,
    "agentId" | "deploymentVersionId" | "deploymentVersionNumber" | "operation"
  >,
): boolean {
  return (
    left.agentId === right.agentId &&
    left.deploymentVersionId === right.deploymentVersionId &&
    left.deploymentVersionNumber === right.deploymentVersionNumber &&
    left.operation === right.operation
  );
}

export async function adoptRuntimeOperationReadyReceipt(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly target: RuntimeSessionLifecycleTarget;
  },
): Promise<"applied" | "duplicate" | "missing" | "stale"> {
  if (input.target.agentId == null) {
    throw new Error("Runtime operation ready adoption requires an Agent-bound Session.");
  }
  const claimSourceEventId = `runtime-operation:${input.operationId}:${input.target.sessionId}:updating`;
  const sourceEventId = `runtime-operation:${input.operationId}:${input.target.sessionId}:ready`;
  const [claim, receipt] = await Promise.all([
    getRuntimeOperationEventReceipt(database, {
      agentId: input.target.agentId,
      operationId: input.operationId,
      sessionId: input.target.sessionId,
      status: "updating",
    }),
    getRuntimeOperationEventReceipt(database, {
      agentId: input.target.agentId,
      operationId: input.operationId,
      sessionId: input.target.sessionId,
      status: "ready",
    }),
  ]);

  if (receipt === null) {
    return "missing";
  }
  if (claim === null) {
    throw new Error(`Runtime operation ready source ${sourceEventId} has no canonical claim.`);
  }
  if (!runtimeOperationEventIdentitiesEqual(claim, receipt)) {
    throw new Error(`Runtime operation ready source ${sourceEventId} conflicts with its claim.`);
  }

  const result = await database
    .prepare(
      `UPDATE session
          SET status = 'IDLE',
              status_operation_id = NULL,
              status_seq = status_seq + 1,
              updated_at = ?
        WHERE id = ?
          AND archived_at IS NULL
          AND cleanup_operation_kind IS NULL
          AND last_run_id IS ?
          AND runtime_event_seq_cursor = ?
          AND status = ?
          AND status_operation_id = ?
          AND status_seq = ?
          AND updated_at = ?
          AND EXISTS (
            SELECT 1
            FROM session_event AS event
            WHERE event.session_id = ?
              AND event.source_event_id = ?
              AND event.id = ?
              AND event.event_type = ?
              AND event.occurred_at = ?
              AND event.runtime_operation_event_json = ?
              AND event.semantic_hash = ?
              AND event.seq = ?
              AND event.source = ?
              AND event.visibility = ?
          )
          AND EXISTS (
            SELECT 1
            FROM session_event AS claim
            WHERE claim.session_id = ?
              AND claim.source_event_id = ?
              AND claim.id = ?
              AND claim.event_type = ?
              AND claim.occurred_at = ?
              AND claim.runtime_operation_event_json = ?
              AND claim.semantic_hash = ?
              AND claim.seq = ?
              AND claim.source = ?
              AND claim.visibility = ?
          )`,
    )
    .bind(
      receipt.occurredAt,
      input.target.sessionId,
      input.target.lastRunId,
      input.target.sessionRuntimeEventSeqCursor,
      input.target.sessionStatus,
      input.operationId,
      input.target.sessionStatusSeq,
      input.target.sessionUpdatedAt,
      input.target.sessionId,
      sourceEventId,
      receipt.eventId,
      receipt.eventType,
      receipt.occurredAt,
      receipt.eventJson,
      receipt.semanticHash,
      receipt.seq,
      receipt.source,
      receipt.visibility,
      input.target.sessionId,
      claimSourceEventId,
      claim.eventId,
      claim.eventType,
      claim.occurredAt,
      claim.eventJson,
      claim.semanticHash,
      claim.seq,
      claim.source,
      claim.visibility,
    )
    .run();
  if (getD1ChangeCount(result) > 0) {
    return "applied";
  }

  const [currentClaim, currentReceipt, session] = await Promise.all([
    getRuntimeOperationEventReceipt(database, {
      agentId: input.target.agentId,
      operationId: input.operationId,
      sessionId: input.target.sessionId,
      status: "updating",
    }),
    getRuntimeOperationEventReceipt(database, {
      agentId: input.target.agentId,
      operationId: input.operationId,
      sessionId: input.target.sessionId,
      status: "ready",
    }),
    database
      .prepare(
        `SELECT archived_at, cleanup_operation_kind, last_run_id,
                runtime_event_seq_cursor, status, status_operation_id
           FROM session
          WHERE id = ?`,
      )
      .bind(input.target.sessionId)
      .first<{
        archived_at: number | null;
        cleanup_operation_kind: string | null;
        last_run_id: string | null;
        runtime_event_seq_cursor: number;
        status: string;
        status_operation_id: string | null;
      }>(),
  ]);

  return currentClaim !== null &&
    currentReceipt !== null &&
    runtimeOperationEventReceiptsEqual(currentClaim, claim) &&
    runtimeOperationEventReceiptsEqual(currentReceipt, receipt) &&
    session?.archived_at === null &&
    session.cleanup_operation_kind === null &&
    session.last_run_id === input.target.lastRunId &&
    session.runtime_event_seq_cursor >= receipt.seq &&
    session.status === "IDLE" &&
    session.status_operation_id === null
    ? "duplicate"
    : "stale";
}

export async function claimRuntimeOperationTargets(
  database: D1Database,
  input: {
    readonly event: RuntimeOperationEvent;
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  const transitions: RuntimeSessionTargetTransition[] = [];
  if (input.event.status !== "updating") {
    throw new Error("Runtime operation target claims require one updating event.");
  }
  const occurredAtMs = Date.parse(input.event.observedAt);

  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("Runtime operation start time must be a valid ISO timestamp.");
  }

  for (
    let index = 0;
    index < input.targets.length;
    index += RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE
  ) {
    const targets = input.targets.slice(index, index + RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE);
    const prepared = await Promise.all(
      targets.map(async (target) => {
        if (target.agentId === null) {
          throw new Error("Runtime operation target claims require an Agent-bound Session.");
        }
        const event = createRuntimeOperationSessionEvent({
          event: input.event,
          operationId: input.operationId,
          sessionId: target.sessionId,
        });
        const preparedEvent = await prepareSessionLifecycleEvent(event, {
          agentId: target.agentId,
          operationId: input.operationId,
          status: "updating",
        });
        const nextStatusSeq = target.sessionStatusSeq + 1;
        const nextEventSeq = target.sessionRuntimeEventSeqCursor + 1;

        return {
          target,
          statements: [
            database
              .prepare(
                `UPDATE session
                    SET runtime_event_seq_cursor = runtime_event_seq_cursor + 1,
                        status = 'RESCHEDULING',
                        status_operation_id = ?,
                        status_seq = status_seq + 1,
                        updated_at = ?
                  WHERE id = ?
                    AND archived_at IS NULL
                    AND cleanup_operation_kind IS NULL
                    AND runtime_provisioning_operation_id IS NULL
                    AND last_run_id IS ?
                    AND runtime_event_seq_cursor = ?
                    AND status = ?
                    AND status_operation_id IS ?
                    AND status_seq = ?
                    AND updated_at = ?`,
              )
              .bind(
                input.operationId,
                occurredAtMs,
                target.sessionId,
                target.lastRunId,
                target.sessionRuntimeEventSeqCursor,
                target.sessionStatus,
                target.sessionStatusOperationId,
                target.sessionStatusSeq,
                target.sessionUpdatedAt,
              ),
            ...createSessionLifecycleEventInsertStatements(database, {
              prepared: preparedEvent,
              target: {
                lastRunId: target.lastRunId,
                operationId: input.operationId,
                runtimeEventSeqCursor: nextEventSeq,
                sessionId: target.sessionId,
                status: "RESCHEDULING",
                statusSeq: nextStatusSeq,
                updatedAt: occurredAtMs,
              },
            }),
          ],
        };
      }),
    );
    const results = await database.batch(prepared.flatMap((record) => record.statements));

    for (const [targetIndex, record] of prepared.entries()) {
      if (getD1ChangeCount(results[targetIndex * 3]) === 0) {
        continue;
      }
      transitions.push({
        current: {
          ...record.target,
          sessionRuntimeEventSeqCursor: record.target.sessionRuntimeEventSeqCursor + 1,
          sessionStatus: "RESCHEDULING",
          sessionStatusOperationId: input.operationId,
          sessionStatusSeq: record.target.sessionStatusSeq + 1,
          sessionUpdatedAt: occurredAtMs,
        },
      });
    }
  }

  return transitions;
}

export async function listRuntimeOperationTargets(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTarget[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const targetsById = new Map(input.targets.map((target) => [target.sessionId, target]));
  const rows = await getAppDatabase(database)
    .select({
      lastRunId: sessionsTable.lastRunId,
      sessionId: sessionsTable.id,
      sessionRuntimeEventSeqCursor: sessionsTable.runtimeEventSeqCursor,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sql<RuntimeSessionTarget["sessionStatus"]>`${sessionsTable.status}`,
      sessionUpdatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .where(
      and(
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        inArray(
          sessionsTable.id,
          input.targets.map((target) => target.sessionId),
        ),
        inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
        eq(sessionsTable.statusOperationId, input.operationId),
      ),
    )
    .all();

  return rows.flatMap((row) => {
    const target = targetsById.get(row.sessionId);

    return target === undefined ? [] : [{ ...target, ...row }];
  });
}

export async function listStaleRuntimeOperationTargets(
  database: D1Database,
  input: {
    readonly limit: number;
    readonly staleUpdatedAtLte: number;
  },
): Promise<StaleRuntimeOperationTarget[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Stale runtime operation target limit must be a positive integer.");
  }

  const rows = await getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      creatorAccountId: sessionsTable.creatorAccountId,
      lastRunId: sessionsTable.lastRunId,
      operationId: sessionsTable.statusOperationId,
      sandboxId: sandboxSessionsTable.sandboxId,
      sessionId: sessionsTable.id,
      sessionRuntimeEventSeqCursor: sessionsTable.runtimeEventSeqCursor,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sql<RuntimeSessionTarget["sessionStatus"]>`${sessionsTable.status}`,
      sessionUpdatedAt: sessionsTable.updatedAt,
    })
    .from(sessionsTable)
    .innerJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .where(
      and(
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        inArray(sessionsTable.status, ["IDLE", "RESCHEDULING"]),
        isNotNull(sessionsTable.statusOperationId),
        lte(sessionsTable.updatedAt, input.staleUpdatedAtLte),
      ),
    )
    .orderBy(asc(sessionsTable.updatedAt), asc(sessionsTable.id))
    .limit(input.limit)
    .all();

  return rows.flatMap((row) =>
    row.operationId === null ? [] : [{ ...row, operationId: row.operationId }],
  );
}

export async function expireStaleRuntimeOperationTargets(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTarget[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const currentTargets = await listRuntimeOperationTargets(database, input);
  const staleBeforeMs = currentTimestampMs() - RESCHEDULING_RECONNECT_WINDOW_MS;

  return currentTargets.filter((target) => target.sessionUpdatedAt <= staleBeforeMs);
}
