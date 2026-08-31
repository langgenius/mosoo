import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import {
  apiCommandsTable,
  sandboxBackupsTable,
  sandboxSessionsTable,
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  ProjectId,
  PlatformId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEventSemanticHash } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, exists, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";
import type { PreparedApiCommand } from "../../../api-command/application/api-command-ledger";
import { createSessionRuntimeEventProjection } from "../../../sessions/domain/session-runtime-event-projection";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { createSessionStatusTransitionPatch } from "./session-lifecycle-projection.repository";

interface QueuedRunAdmissionRecord {
  agentId: AgentId;
  createdBy: AccountId;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  runtimeId: string | null;
  sessionId: SessionId;
  timestampMs: number;
  traceId: string;
  trigger: SessionRunTrigger;
}

interface QueuedMessageAdmissionRecord {
  content: string;
  createdByAccountId: PlatformId;
  id: SessionMessageId;
  timestampMs: number;
}

type SourcedRuntimeEventEnvelope = RuntimeEventEnvelope & {
  readonly sourceEventId: string;
};

export interface CommitQueuedSessionRunAdmissionInput {
  apiCommand: PreparedApiCommand;
  clientRequestId: string | null;
  events: readonly RuntimeEventEnvelope[];
  message: QueuedMessageAdmissionRecord;
  run: QueuedRunAdmissionRecord;
  session: {
    agentId: AgentId;
    projectId: ProjectId;
    id: SessionId;
  };
}

function selectedValue<T>(value: T, alias: string) {
  return sql<T>`${value}`.as(alias);
}

function admissionSessionPredicate(input: CommitQueuedSessionRunAdmissionInput) {
  return and(
    eq(sessionsTable.id, input.session.id),
    eq(sessionsTable.agentId, input.session.agentId),
    eq(sessionsTable.projectId, input.session.projectId),
    eq(sessionsTable.lastRunId, input.run.id),
    eq(sessionsTable.status, "RUNNING"),
    isNull(sessionsTable.runtimeProvisioningOperationId),
  );
}

export function cattleTerminalCheckpointReadyPredicate(db: AppDatabase): SQL {
  return or(
    ne(sessionsTable.kind, "cattle"),
    eq(sessionsTable.workspaceCheckpointRequired, false),
    isNull(sessionsTable.lastRunId),
    notExists(
      db
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(sessionRunsTable.id, sessionsTable.lastRunId),
            eq(sessionRunsTable.status, "completed"),
          ),
        ),
    ),
    exists(
      db
        .select({ id: sandboxBackupsTable.id })
        .from(sandboxBackupsTable)
        .innerJoin(
          sandboxSessionsTable,
          and(
            eq(sandboxSessionsTable.sessionId, sessionsTable.id),
            eq(sandboxSessionsTable.sandboxId, sandboxBackupsTable.sandboxId),
            eq(sandboxSessionsTable.sandboxIncarnation, sandboxBackupsTable.sandboxIncarnation),
            eq(sandboxSessionsTable.cwd, sandboxBackupsTable.dir),
            eq(sandboxBackupsTable.workspaceSessionId, sandboxSessionsTable.sessionId),
          ),
        )
        .where(
          and(
            eq(sandboxBackupsTable.sessionRunId, sessionsTable.lastRunId),
            eq(sandboxBackupsTable.status, "ready"),
          ),
        ),
    ),
  )!;
}

function claimableSessionPredicate(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return and(
    eq(sessionsTable.id, input.session.id),
    eq(sessionsTable.agentId, input.session.agentId),
    eq(sessionsTable.projectId, input.session.projectId),
    isNull(sessionsTable.archivedAt),
    eq(sessionsTable.status, "IDLE"),
    isNull(sessionsTable.statusOperationId),
    isNull(sessionsTable.runtimeProvisioningOperationId),
    cattleTerminalCheckpointReadyPredicate(db),
    notExists(
      db
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(sessionRunsTable.sessionId, input.session.id),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          ),
        ),
    ),
    input.clientRequestId === null
      ? sql`TRUE`
      : notExists(
          db
            .select({ id: sessionEventsTable.id })
            .from(sessionEventsTable)
            .where(
              and(
                eq(sessionEventsTable.sessionId, input.session.id),
                eq(sessionEventsTable.sourceEventId, input.clientRequestId),
              ),
            ),
        ),
  );
}

export async function isCattleTerminalCheckpointReadyForNextRun(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const appDb = getAppDatabase(database);
  const [session, ready] = await Promise.all([
    appDb
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1)
      .get(),
    appDb
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), cattleTerminalCheckpointReadyPredicate(appDb)))
      .limit(1)
      .get(),
  ]);
  return session === undefined || ready !== undefined;
}

export async function hasSessionRunAdmissionClientRequestReceipt(
  database: D1Database,
  input: { clientRequestId: string | null; sessionId: SessionId },
): Promise<boolean> {
  if (input.clientRequestId === null) {
    return false;
  }

  const receipt =
    (await getAppDatabase(database)
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          eq(sessionEventsTable.sourceEventId, input.clientRequestId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return receipt !== null;
}

function createRunInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return db.insert(sessionRunsTable).select(
    db
      .select({
        agentId: selectedValue(input.run.agentId, "agent_id"),
        completedAt: selectedValue(null, "completed_at"),
        createdAt: selectedValue(input.run.timestampMs, "created_at"),
        createdByAccountId: selectedValue(input.run.createdBy, "created_by_account_id"),
        deploymentVersionId: selectedValue(input.run.deploymentVersionId, "deployment_version_id"),
        deploymentVersionNumber: selectedValue(
          input.run.deploymentVersionNumber,
          "deployment_version_number",
        ),
        driverInstanceId: selectedValue(null, "driver_instance_id"),
        errorCode: selectedValue(null, "error_code"),
        errorDetailsJson: selectedValue(null, "error_details_json"),
        errorMessage: selectedValue(null, "error_message"),
        errorRetryable: selectedValue(null, "error_retryable"),
        id: selectedValue(input.run.id, "id"),
        model: selectedValue(input.run.model, "model"),
        provider: selectedValue(input.run.provider, "provider"),
        runtimeId: selectedValue(input.run.runtimeId, "runtime_id"),
        sessionId: sessionsTable.id,
        startedAt: selectedValue(null, "started_at"),
        status: selectedValue("queued" as const, "status"),
        statusChangedAt: selectedValue(input.run.timestampMs, "status_changed_at"),
        statusEvent: selectedValue("run.queue", "status_event"),
        statusOperationId: selectedValue(null, "status_operation_id"),
        statusSeq: selectedValue(0, "status_seq"),
        statusSource: selectedValue("api", "status_source"),
        terminalReconciliationAttemptedAt: selectedValue(
          null,
          "terminal_reconciliation_attempted_at",
        ),
        traceId: selectedValue(input.run.traceId, "trace_id"),
        trigger: selectedValue(input.run.trigger, "trigger"),
        updatedAt: selectedValue(input.run.timestampMs, "updated_at"),
      })
      .from(sessionsTable)
      .where(claimableSessionPredicate(db, input)),
  );
}

function createMessageInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return db.insert(sessionMessagesTable).select(
    db
      .select({
        contentText: selectedValue(input.message.content, "content_text"),
        createdAt: selectedValue(input.message.timestampMs, "created_at"),
        createdByAccountId: selectedValue(
          input.message.createdByAccountId,
          "created_by_account_id",
        ),
        id: selectedValue(input.message.id, "id"),
        planJson: selectedValue(null, "plan_json"),
        projectionFormat: selectedValue("materialized" as const, "projection_format"),
        role: selectedValue("user" as const, "role"),
        segmentsJson: selectedValue(null, "segments_json"),
        seq: sessionsTable.messageSeqCursor,
        sessionId: sessionsTable.id,
        sessionRunId: selectedValue(input.run.id, "session_run_id"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

function runtimeEventOccurredAt(event: RuntimeEventEnvelope, fallbackMs: number): number {
  const occurredAt = Date.parse(event.occurredAt);
  return Number.isFinite(occurredAt) ? occurredAt : fallbackMs;
}

function sourceAdmissionEvent(
  event: RuntimeEventEnvelope,
  index: number,
  clientRequestId: string | null,
): SourcedRuntimeEventEnvelope {
  return {
    ...event,
    sourceEventId: event.sourceEventId ?? (index === 0 ? clientRequestId : null) ?? event.id,
  };
}

function createEventInsertQuery(
  db: AppDatabase,
  input: CommitQueuedSessionRunAdmissionInput,
  event: SourcedRuntimeEventEnvelope,
  index: number,
  semanticHash: string,
) {
  const projection = createSessionRuntimeEventProjection(event);
  const timestampMs = input.run.timestampMs + index;
  const occurredAt = runtimeEventOccurredAt(event, timestampMs);

  return db.insert(sessionEventsTable).select(
    db
      .select({
        agentId: sessionsTable.agentId,
        artifactAttemptId: selectedValue(null, "artifact_attempt_id"),
        artifactManifestJson: selectedValue(null, "artifact_manifest_json"),
        artifactManifestSha256: selectedValue(null, "artifact_manifest_sha256"),
        contentText: selectedValue(projection.contentText, "content_text"),
        createdAt: selectedValue(timestampMs, "created_at"),
        endedAt: selectedValue(Math.max(occurredAt, timestampMs), "ended_at"),
        eventType: selectedValue(projection.eventType, "event_type"),
        family: selectedValue(projection.family, "family"),
        id: selectedValue(event.id, "id"),
        mcpCommandId: selectedValue(projection.mcpCommandId, "mcp_command_id"),
        occurredAt: selectedValue(occurredAt, "occurred_at"),
        processStatus: selectedValue(projection.processStatus, "process_status"),
        processType: selectedValue(projection.processType, "process_type"),
        runId: selectedValue(projection.runId, "run_id"),
        runtimeOperationEventJson: selectedValue(null, "runtime_operation_event_json"),
        semanticHash: selectedValue(semanticHash, "semantic_hash"),
        seq: sql<number>`${sessionsTable.runtimeEventSeqCursor} - ${input.events.length - index - 1}`.as(
          "seq",
        ),
        sessionId: sessionsTable.id,
        sourceEventId: selectedValue(event.sourceEventId, "source_event_id"),
        source: selectedValue(projection.source, "source"),
        streamId: selectedValue(projection.streamId, "stream_id"),
        terminalEventJson: selectedValue(null, "terminal_event_json"),
        toolCallId: selectedValue(projection.toolCallId, "tool_call_id"),
        toolInputDeltaJson: selectedValue(projection.toolInputDeltaJson, "tool_input_delta_json"),
        toolInputJson: selectedValue(projection.toolInputJson, "tool_input_json"),
        toolName: selectedValue(projection.toolName, "tool_name"),
        toolOutputDeltaText: selectedValue(
          projection.toolOutputDeltaText,
          "tool_output_delta_text",
        ),
        toolOutputText: selectedValue(projection.toolOutputText, "tool_output_text"),
        toolParentMessageId: selectedValue(
          projection.toolParentMessageId,
          "tool_parent_message_id",
        ),
        toolResultMessageId: selectedValue(
          projection.toolResultMessageId,
          "tool_result_message_id",
        ),
        toolStatus: selectedValue(projection.toolStatus, "tool_status"),
        tokens: selectedValue(projection.tokens, "tokens"),
        traceId: selectedValue(projection.traceId, "trace_id"),
        visibility: selectedValue(projection.visibility, "visibility"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

function createApiCommandInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  const record = input.apiCommand.record;

  return db.insert(apiCommandsTable).select(
    db
      .select({
        attemptCount: selectedValue(record.attemptCount, "attempt_count"),
        claimExpiresAt: selectedValue(record.claimExpiresAt, "claim_expires_at"),
        claimOwner: selectedValue(record.claimOwner, "claim_owner"),
        completedAt: selectedValue(record.completedAt, "completed_at"),
        createdAt: selectedValue(record.createdAt, "created_at"),
        dedupeKey: selectedValue(record.dedupeKey, "dedupe_key"),
        deliveryGeneration: selectedValue(record.deliveryGeneration, "delivery_generation"),
        id: selectedValue(record.id, "id"),
        kind: selectedValue(record.kind, "kind"),
        lastErrorCode: selectedValue(record.lastErrorCode, "last_error_code"),
        lastErrorMessage: selectedValue(record.lastErrorMessage, "last_error_message"),
        payloadJson: selectedValue(record.payloadJson, "payload_json"),
        status: selectedValue(record.status, "status"),
        updatedAt: selectedValue(record.updatedAt, "updated_at"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

export async function commitQueuedSessionRunAdmission(
  database: D1Database,
  input: CommitQueuedSessionRunAdmissionInput,
): Promise<boolean> {
  if (input.events.length === 0) {
    throw new Error("Queued Session Run admission requires canonical runtime events.");
  }

  for (const event of input.events) {
    if (event.sessionId !== input.session.id || event.runId !== input.run.id) {
      throw new Error("Queued Session Run admission event scope does not match the Run.");
    }
  }

  const events = input.events.map((event, index) =>
    sourceAdmissionEvent(event, index, input.clientRequestId),
  );
  const semanticHashes = await Promise.all(events.map(createRuntimeEventSemanticHash));

  const results = await runAppDatabaseBatch(database, (db) => {
    const eventInserts = events.map((event, index) => {
      const semanticHash = semanticHashes[index];
      if (semanticHash === undefined) {
        throw new Error("Queued Session Run admission event hash is missing.");
      }
      return createEventInsertQuery(db, input, event, index, semanticHash);
    });

    return [
      createRunInsertQuery(db, input),
      db
        .update(sessionsTable)
        .set({
          lastMessageAt: input.message.timestampMs,
          lastRunId: input.run.id,
          messageSeqCursor: sql`${sessionsTable.messageSeqCursor} + 1`,
          model: sql`COALESCE(${input.run.model}, ${sessionsTable.model})`,
          provider: sql`COALESCE(${input.run.provider}, ${sessionsTable.provider})`,
          runtimeEventSeqCursor: sql`${sessionsTable.runtimeEventSeqCursor} + ${input.events.length}`,
          ...createSessionStatusTransitionPatch({
            status: "RUNNING",
            timestampMs: input.run.timestampMs,
          }),
        })
        .where(
          and(
            eq(sessionsTable.id, input.session.id),
            eq(sessionsTable.agentId, input.session.agentId),
            eq(sessionsTable.projectId, input.session.projectId),
            isNull(sessionsTable.archivedAt),
            eq(sessionsTable.status, "IDLE"),
            isNull(sessionsTable.statusOperationId),
            isNull(sessionsTable.runtimeProvisioningOperationId),
            exists(
              db
                .select({ id: sessionRunsTable.id })
                .from(sessionRunsTable)
                .where(eq(sessionRunsTable.id, input.run.id)),
            ),
          ),
        ),
      createMessageInsertQuery(db, input),
      ...eventInserts,
      createApiCommandInsertQuery(db, input),
    ];
  });

  return getD1ChangeCount((results as readonly unknown[])[0]) > 0;
}
